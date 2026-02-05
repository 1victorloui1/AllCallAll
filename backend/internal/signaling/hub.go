// 信令中枢：管理 WebSocket 连接、转发消息并记录日志
package signaling

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/calllog"
	"github.com/allcallall/backend/internal/chatlog"
	"github.com/allcallall/backend/internal/media"
	"github.com/allcallall/backend/internal/presence"
)

// Hub 管理所有 WebSocket 连接
// Hub orchestrates signaling sessions across users and instances.
// 现在同时支持 WebSocket 信令和 Pion WebRTC 媒体引擎
// Now supports both WebSocket signaling and Pion WebRTC media engine
type Hub struct {
	redis       *redis.Client
	logger      zerolog.Logger
	presence    *presence.Manager
	mediaEngine *media.Engine
	callLogs    *calllog.Service
	chatLogs    *chatlog.Service

	mu      sync.RWMutex
	clients map[string]map[*client]struct{}
	nodeID  string
}

// SignalMessage 信令消息
// SignalMessage represents the payload exchanged between peers.
type SignalMessage struct {
	Type    string          `json:"type"`
	CallID  string          `json:"call_id,omitempty"`
	To      string          `json:"to"`
	From    string          `json:"from"`
	Payload json.RawMessage `json:"payload"`
}

// 信令消息类型常量
const (
	TypeCallInvite    = "call.invite"
	TypeCallInviteAck = "call.invite.ack"
	TypeCallAccept    = "call.accept"
	TypeCallReject    = "call.reject"
	TypeCallEnd       = "call.end"
	TypeIceCandidate  = "ice.candidate"
	TypeChatMessage   = "chat.message"
)

// 连接包装：每个邮箱可有多个连接
type client struct {
	email string
	conn  *websocket.Conn
	send  chan []byte
}

// Redis 转发封装
type redisEnvelope struct {
	NodeID string          `json:"node_id"`
	Data   json.RawMessage `json:"data"`
}

// NewHub 创建 Hub
// NewHub constructs a signaling hub.
func NewHub(redis *redis.Client, logger zerolog.Logger, presence *presence.Manager) *Hub {
	return &Hub{
		redis:    redis,
		logger:   logger.With().Str("component", "signaling_hub").Logger(),
		presence: presence,
		clients:  make(map[string]map[*client]struct{}),
		nodeID:   uuid.NewString(),
	}
}

// HandleConnection 处理单个连接
// HandleConnection attaches websocket connection to the hub.
func (h *Hub) HandleConnection(ctx context.Context, email string, conn *websocket.Conn) {
	// 创建客户端连接对象
	cl := &client{
		email: email,
		conn:  conn,
		send:  make(chan []byte, 16),
	}

	// 绑定可取消的上下文
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// 标记在线状态，并在断开时标记离线
	if h.presence != nil {
		if err := h.presence.SetOnline(ctx, email); err != nil {
			h.logger.Warn().Err(err).Str("email", email).Msg("failed to mark user online")
		}
		defer func() {
			timeoutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := h.presence.SetOffline(timeoutCtx, email); err != nil {
				h.logger.Warn().Err(err).Str("email", email).Msg("failed to mark user offline")
			}
		}()
	}

	// 维护连接映射
	h.addClient(cl)
	defer h.removeClient(cl)

	// 写协程：把消息发到 WebSocket
	go h.writeLoop(ctx, cl)

	// Redis channel for cross-instance delivery.
	// 跨实例转发：订阅属于该邮箱的通道
	sub := h.redis.Subscribe(ctx, h.channelName(email))
	defer sub.Close()

	// Redis 消息转发协程
	go h.redisForwarder(ctx, sub, cl)

	// 主循环：读取客户端消息并处理
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if err := h.handleIncoming(ctx, cl, data); err != nil {
			h.logger.Warn().Err(err).Msg("failed to handle incoming signaling message")
		}
	}
}

func (h *Hub) handleIncoming(ctx context.Context, fromClient *client, data []byte) error {
	// 刷新在线时间
	if h.presence != nil {
		if err := h.presence.UpdateLastSeen(ctx, fromClient.email); err != nil {
			h.logger.Debug().Err(err).Str("email", fromClient.email).Msg("failed to refresh last seen")
		}
	}

	// 解析信令消息
	var msg SignalMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return fmt.Errorf("decode message: %w", err)
	}
	if msg.To == "" {
		return fmt.Errorf("missing target 'to'")
	}
	msg.From = fromClient.email

	// 应用协议规则（补全 call_id、ack、校验）
	ackMsg, err := h.applyProtocolRules(&msg)
	if err != nil {
		return err
	}

	// 记录通话/聊天日志
	h.recordCallEvent(ctx, &msg)
	h.recordChatMessage(ctx, &msg)

	// 编码要转发的消息
	encoded, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	// 本机直投（同实例在线）
	h.dispatchLocal(msg.To, encoded)

	// 通过 Redis 发布给其他实例
	envBytes, err := json.Marshal(redisEnvelope{
		NodeID: h.nodeID,
		Data:   encoded,
	})
	if err != nil {
		return err
	}

	// 对 call.invite 返回 ack
	if ackMsg != nil {
		if ackBytes, err := json.Marshal(ackMsg); err == nil {
			h.dispatchLocal(msg.From, ackBytes)
		} else {
			h.logger.Warn().Err(err).Msg("failed to marshal ack message")
		}
	}

	// 发布到目标邮箱通道
	return h.redis.Publish(ctx, h.channelName(msg.To), envBytes).Err()
}

// WithCallLogService attaches call log service to signaling hub.
// 绑定通话记录服务
func (h *Hub) WithCallLogService(service *calllog.Service) {
	h.callLogs = service
}

// WithChatLogService attaches chat log service to signaling hub.
// 绑定聊天记录服务
func (h *Hub) WithChatLogService(service *chatlog.Service) {
	h.chatLogs = service
}

func (h *Hub) recordCallEvent(ctx context.Context, msg *SignalMessage) {
	// 未配置通话记录服务则跳过
	if h.callLogs == nil {
		return
	}

	// 按信令类型记录通话状态
	switch msg.Type {
	case TypeCallInvite:
		if err := h.callLogs.RecordInvite(ctx, msg.CallID, msg.From, msg.To); err != nil {
			h.logger.Warn().Err(err).Str("call_id", msg.CallID).Msg("record call invite failed")
		}
	case TypeCallAccept:
		if err := h.callLogs.RecordAccept(ctx, msg.CallID); err != nil {
			h.logger.Warn().Err(err).Str("call_id", msg.CallID).Msg("record call accept failed")
		}
	case TypeCallReject, TypeCallEnd:
		if err := h.callLogs.RecordEnd(ctx, msg.CallID); err != nil {
			h.logger.Warn().Err(err).Str("call_id", msg.CallID).Msg("record call end failed")
		}
	default:
	}
}

func (h *Hub) recordChatMessage(ctx context.Context, msg *SignalMessage) {
	// 未配置聊天记录服务或消息类型不符则跳过
	if h.chatLogs == nil {
		return
	}
	if msg.Type != TypeChatMessage {
		return
	}
	if len(msg.Payload) == 0 {
		return
	}

	// 解析聊天内容
	var payload struct {
		Text   string `json:"text"`
		SentAt string `json:"sent_at"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.logger.Warn().Err(err).Msg("decode chat payload failed")
		return
	}
	body := strings.TrimSpace(payload.Text)
	if body == "" {
		return
	}

	// 解析发送时间，失败则使用当前时间
	sentAt := time.Now()
	if payload.SentAt != "" {
		if parsed, err := time.Parse(time.RFC3339, payload.SentAt); err == nil {
			sentAt = parsed
		}
	}

	// 写入聊天记录
	if err := h.chatLogs.RecordMessage(ctx, msg.From, msg.To, body, sentAt); err != nil {
		h.logger.Warn().Err(err).Msg("record chat message failed")
	}
}

func (h *Hub) applyProtocolRules(msg *SignalMessage) (*SignalMessage, error) {
	// 对关键消息进行校验/补全
	switch msg.Type {
	case TypeCallInvite:
		// 如果没有 call_id，则生成
		if msg.CallID == "" {
			msg.CallID = uuid.NewString()
		}
		// 生成邀请回执
		return &SignalMessage{
			Type:    TypeCallInviteAck,
			CallID:  msg.CallID,
			To:      msg.From,
			From:    msg.From,
			Payload: msg.Payload,
		}, nil
	case TypeCallAccept, TypeCallReject, TypeCallEnd:
		// 需要 call_id
		if msg.CallID == "" {
			return nil, fmt.Errorf("call_id required for message type %s", msg.Type)
		}
	case TypeIceCandidate:
		// 需要 call_id 与 payload
		if msg.CallID == "" {
			return nil, fmt.Errorf("call_id required for ice candidate message")
		}
		if len(msg.Payload) == 0 {
			return nil, fmt.Errorf("payload required for ice candidate message")
		}
	default:
		// Legacy types (offer/answer/etc.) are still allowed without additional validation.
	}
	return nil, nil
}

func (h *Hub) addClient(cl *client) {
	// 添加连接到内存映射
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[cl.email]; !ok {
		h.clients[cl.email] = make(map[*client]struct{})
	}
	h.clients[cl.email][cl] = struct{}{}
	h.logger.Info().Str("email", cl.email).Msg("client connected")
}

func (h *Hub) removeClient(cl *client) {
	// 从内存映射移除连接
	h.mu.Lock()
	defer h.mu.Unlock()
	if conns, ok := h.clients[cl.email]; ok {
		delete(conns, cl)
		if len(conns) == 0 {
			delete(h.clients, cl.email)
		}
	}
	close(cl.send)
	_ = cl.conn.Close()
	h.logger.Info().Str("email", cl.email).Msg("client disconnected")
}

func (h *Hub) dispatchLocal(target string, payload []byte) {
	// 向本机所有目标用户连接广播
	h.mu.RLock()
	defer h.mu.RUnlock()
	for cl := range h.clients[target] {
		select {
		case cl.send <- payload:
		default:
			h.logger.Warn().Str("email", target).Msg("dropping signaling message due to slow client")
		}
	}
}

func (h *Hub) writeLoop(ctx context.Context, cl *client) {
	// 从发送通道写入 WebSocket
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-cl.send:
			if !ok {
				return
			}
			if err := cl.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				h.logger.Warn().Err(err).Str("email", cl.email).Msg("write message failed")
				return
			}
		}
	}
}

func (h *Hub) redisForwarder(ctx context.Context, sub *redis.PubSub, cl *client) {
	// 订阅 Redis 通道并转发到本地连接
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var env redisEnvelope
			if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
				h.logger.Warn().Err(err).Msg("failed to decode redis envelope")
				continue
			}
			if env.NodeID == h.nodeID {
				continue
			}
			// 转发到客户端发送通道
			select {
			case cl.send <- env.Data:
			default:
				h.logger.Warn().Str("email", cl.email).Msg("drop redis message due to slow client")
			}
		}
	}
}

func (h *Hub) channelName(email string) string {
	// 以邮箱为维度的 Redis 通道名
	return fmt.Sprintf("signal:%s", email)
}
