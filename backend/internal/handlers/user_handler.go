// 用户相关处理器：个人信息、联系人、在线状态与日志接口
package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/auth"
	"github.com/allcallall/backend/internal/calllog"
	"github.com/allcallall/backend/internal/chatlog"
	"github.com/allcallall/backend/internal/contact"
	"github.com/allcallall/backend/internal/presence"
	"github.com/allcallall/backend/internal/recording"
	"github.com/allcallall/backend/internal/user"
)

// UserHandler 用户相关接口
// UserHandler serves user-focused endpoints.
type UserHandler struct {
	logger     zerolog.Logger
	users      *user.Service
	presence   *presence.Manager
	contacts   *contact.Service
	callLogs   *calllog.Service
	chatLogs   *chatlog.Service
	recordings *recording.Service
}

// NewUserHandler 构造函数
// NewUserHandler creates a UserHandler.
func NewUserHandler(log zerolog.Logger, users *user.Service, presence *presence.Manager, contacts *contact.Service, callLogs *calllog.Service, chatLogs *chatlog.Service, recordings *recording.Service) *UserHandler {
	return &UserHandler{
		logger:     log.With().Str("component", "user_handler").Logger(),
		users:      users,
		presence:   presence,
		contacts:   contacts,
		callLogs:   callLogs,
		chatLogs:   chatLogs,
		recordings: recordings,
	}
}

// RegisterRoutes 注册用户路由
// RegisterRoutes attaches user routes.
func (h *UserHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/me", h.handleMe)
	rg.GET("/search", h.handleSearch)
	rg.GET("/presence", h.handlePresence)
	rg.POST("/change-password", h.handleChangePassword)
	rg.GET("/call-logs", h.handleCallLogs)
	rg.GET("/chat-logs", h.handleChatLogs)

	contactsGroup := rg.Group("/contacts")
	contactsGroup.GET("", h.handleListContacts)
	contactsGroup.POST("", h.handleAddContact)
	contactsGroup.DELETE("/:id", h.handleRemoveContact)
}

// handleMe 获取当前用户信息
func (h *UserHandler) handleMe(c *gin.Context) {
	// 从 JWT 中取出用户声明
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	userModel, err := h.users.GetByID(c.Request.Context(), claims.UserID)
	if err != nil {
		h.logger.Error().Err(err).Uint64("user_id", claims.UserID).Msg("failed to load profile")
		JSONError(c, http.StatusInternalServerError, "failed to load profile")
		return
	}

	// 查询用户信息并返回
	JSONSuccess(c, http.StatusOK, gin.H{
		"user": gin.H{
			"id":           userModel.ID,
			"email":        userModel.Email,
			"display_name": userModel.DisplayName,
		},
	})
}

// handleSearch 按邮箱关键字搜索用户
func (h *UserHandler) handleSearch(c *gin.Context) {
	// 需要登录才能搜索
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 空搜索直接返回空数组
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		JSONSuccess(c, http.StatusOK, gin.H{"results": []userDTO{}})
		return
	}

	results, err := h.users.SearchByEmail(c.Request.Context(), query, 10)
	if err != nil {
		h.logger.Error().Err(err).Msg("search users failed")
		JSONError(c, http.StatusInternalServerError, "failed to search users")
		return
	}

	// 查询并过滤自己
	response := make([]userDTO, 0, len(results))
	for _, u := range results {
		// 不返回自己
		if u.Email == claims.Email {
			continue
		}
		response = append(response, userDTO{
			ID:          u.ID,
			Email:       u.Email,
			DisplayName: u.DisplayName,
		})
	}

	JSONSuccess(c, http.StatusOK, gin.H{"results": response})
}

// handlePresence 批量获取在线状态
func (h *UserHandler) handlePresence(c *gin.Context) {
	// 需要登录才能查询在线状态
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 解析查询参数 emails（为空则只查自己）
	var emails []string
	raw := strings.TrimSpace(c.Query("emails"))
	if raw == "" {
		emails = []string{claims.Email}
	} else {
		for _, part := range strings.Split(raw, ",") {
			email := strings.TrimSpace(part)
			if email != "" {
				emails = append(emails, email)
			}
		}
		if len(emails) == 0 {
			emails = []string{claims.Email}
		}
	}

	statuses, err := h.presence.GetStatuses(c.Request.Context(), emails)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to fetch presence")
		JSONError(c, http.StatusInternalServerError, "failed to fetch presence")
		return
	}

	// 获取在线状态并组装响应
	resp := make([]gin.H, 0, len(statuses))
	for _, email := range emails {
		status := statuses[email]
		resp = append(resp, gin.H{
			"email":     status.Email,
			"online":    status.Online,
			"last_seen": status.LastSeen,
		})
	}

	JSONSuccess(c, http.StatusOK, gin.H{"presence": resp})
}

// handleCallLogs 获取通话记录
func (h *UserHandler) handleCallLogs(c *gin.Context) {
	// 需要登录才能查看
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	if h.callLogs == nil {
		JSONError(c, http.StatusServiceUnavailable, "call log service unavailable")
		return
	}

	// 读取并限制数量
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = parsed
		}
	}

	logs, err := h.callLogs.List(c.Request.Context(), claims.UserID, limit)
	if err != nil {
		h.logger.Error().Err(err).Msg("list call logs failed")
		JSONError(c, http.StatusInternalServerError, "failed to list call logs")
		return
	}

	// 查询通话记录并转换为响应结构
	response := make([]gin.H, 0, len(logs))
	for _, log := range logs {
		recordingStatus := ""
		recordingAvailable := false
		if h.recordings != nil {
			if status, ok := h.recordings.GetRecordingStatus(c.Request.Context(), log.CallID, claims.UserID); ok {
				recordingStatus = status
				recordingAvailable = true
			}
		}
		response = append(response, gin.H{
			"id":                  log.ID,
			"call_id":             log.CallID,
			"peer_email":          log.PeerEmail,
			"peer_display_name":   log.PeerDisplayName,
			"direction":           log.Direction,
			"status":              log.Status,
			"started_at":          log.StartedAt,
			"answered_at":         log.AnsweredAt,
			"ended_at":            log.EndedAt,
			"created_at":          log.CreatedAt,
			"recording_status":    recordingStatus,
			"recording_available": recordingAvailable,
		})
	}

	JSONSuccess(c, http.StatusOK, gin.H{"call_logs": response})
}

// handleChatLogs 获取聊天记录
func (h *UserHandler) handleChatLogs(c *gin.Context) {
	// 需要登录才能查看
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	if h.chatLogs == nil {
		JSONError(c, http.StatusServiceUnavailable, "chat log service unavailable")
		return
	}

	// 读取对话对象
	peerEmail := strings.TrimSpace(c.Query("peer_email"))
	if peerEmail == "" {
		JSONError(c, http.StatusBadRequest, "peer_email required")
		return
	}

	// 读取并限制数量
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = parsed
		}
	}

	logs, err := h.chatLogs.ListConversation(c.Request.Context(), claims.UserID, peerEmail, limit)
	if err != nil {
		h.logger.Error().Err(err).Msg("list chat logs failed")
		JSONError(c, http.StatusInternalServerError, "failed to list chat logs")
		return
	}

	// 查询聊天记录并转换为响应结构
	response := make([]gin.H, 0, len(logs))
	for _, log := range logs {
		direction := "incoming"
		if log.SenderID == claims.UserID {
			direction = "outgoing"
		}
		response = append(response, gin.H{
			"id":                    log.ID,
			"sender_email":          log.SenderEmail,
			"sender_display_name":   log.SenderDisplayName,
			"receiver_email":        log.ReceiverEmail,
			"receiver_display_name": log.ReceiverDisplayName,
			"body":                  log.Body,
			"sent_at":               log.SentAt,
			"created_at":            log.CreatedAt,
			"direction":             direction,
		})
	}

	JSONSuccess(c, http.StatusOK, gin.H{"chat_logs": response})
}

// 添加联系人请求体
type addContactRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// handleAddContact 通过邮箱添加联系人
func (h *UserHandler) handleAddContact(c *gin.Context) {
	// 需要登录才能添加联系人
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 解析请求体
	var req addContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	// 调用联系人服务完成添加
	if err := h.contacts.AddByEmail(c.Request.Context(), claims.UserID, claims.Email, strings.TrimSpace(req.Email)); err != nil {
		switch err {
		case contact.ErrContactExists:
			JSONError(c, http.StatusConflict, "contact already exists")
		case contact.ErrSelfContact:
			JSONError(c, http.StatusBadRequest, "cannot add yourself")
		default:
			h.logger.Error().Err(err).Msg("add contact failed")
			JSONError(c, http.StatusInternalServerError, "failed to add contact")
		}
		return
	}

	// 成功响应
	JSONSuccess(c, http.StatusCreated, gin.H{"success": true})
}

// handleListContacts 获取联系人列表
func (h *UserHandler) handleListContacts(c *gin.Context) {
	// 需要登录才能查看联系人
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	contacts, err := h.contacts.List(c.Request.Context(), claims.UserID)
	if err != nil {
		h.logger.Error().Err(err).Msg("list contacts failed")
		JSONError(c, http.StatusInternalServerError, "failed to list contacts")
		return
	}

	// 查询联系人并转换为响应结构
	response := make([]userDTO, 0, len(contacts))
	for _, u := range contacts {
		response = append(response, userDTO{
			ID:          u.ID,
			Email:       u.Email,
			DisplayName: u.DisplayName,
		})
	}

	JSONSuccess(c, http.StatusOK, gin.H{"contacts": response})
}

// handleRemoveContact 删除联系人
func (h *UserHandler) handleRemoveContact(c *gin.Context) {
	// 需要登录才能删除联系人
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 解析联系人 ID
	idParam := c.Param("id")
	contactID, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		JSONError(c, http.StatusBadRequest, "invalid contact id")
		return
	}

	// 执行删除
	if err := h.contacts.Remove(c.Request.Context(), claims.UserID, contactID); err != nil {
		h.logger.Error().Err(err).Uint64("contact_id", contactID).Msg("remove contact failed")
		JSONError(c, http.StatusInternalServerError, "failed to remove contact")
		return
	}

	// 成功响应
	JSONSuccess(c, http.StatusOK, gin.H{"success": true})
}

// 改密请求体
type changePasswordRequest struct {
	OldPassword     string `json:"old_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required"`
	ConfirmPassword string `json:"confirm_password" binding:"required"`
}

// handleChangePassword 修改密码
func (h *UserHandler) handleChangePassword(c *gin.Context) {
	// 需要登录才能修改密码
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 解析请求体
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	// 调用用户服务完成改密
	err = h.users.ChangePassword(c.Request.Context(), claims.UserID, user.ChangePasswordInput{
		OldPassword:     req.OldPassword,
		NewPassword:     req.NewPassword,
		ConfirmPassword: req.ConfirmPassword,
	})

	if err != nil {
		switch err {
		case user.ErrInvalidCredentials:
			JSONError(c, http.StatusUnauthorized, "invalid old password")
		case user.ErrPasswordTooShort:
			JSONError(c, http.StatusBadRequest, "password must be at least 8 characters")
		case user.ErrPasswordTooLong:
			JSONError(c, http.StatusBadRequest, "password must be at most 128 characters")
		case user.ErrPasswordWeak:
			JSONError(c, http.StatusBadRequest, "password must contain both letters and numbers")
		case user.ErrSpecialCharacters:
			JSONError(c, http.StatusBadRequest, "password cannot contain special characters")
		case user.ErrPasswordMismatch:
			JSONError(c, http.StatusBadRequest, "new password and confirm password do not match")
		case user.ErrPasswordUnchanged:
			JSONError(c, http.StatusBadRequest, "new password must be different from old password")
		case user.ErrNotFound:
			JSONError(c, http.StatusNotFound, "user not found")
		default:
			h.logger.Error().Err(err).Msg("change password failed")
			JSONError(c, http.StatusInternalServerError, "failed to change password")
		}
		return
	}

	// 成功响应
	JSONSuccess(c, http.StatusOK, gin.H{"message": "password changed successfully"})
}
