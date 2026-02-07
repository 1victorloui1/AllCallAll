// WebSocket 信令客户端：封装连接、重连与消息派发
import mitt from "mitt";

import { WS_URL } from "../config";

// SDP 描述负载
export type SessionDescriptionPayload = {
  type: "offer" | "answer";
  sdp: string;
};

// 支持的信令消息类型
export type SignalMessageType =
  | "call.invite"
  | "call.invite.ack"
  | "call.accept"
  | "call.reject"
  | "call.end"
  | "call.record.start"
  | "ice.candidate"
  | "call.error"
  | "chat.message";

// 通用信令消息结构
export interface SignalMessage {
  type: SignalMessageType;
  call_id?: string;
  to: string;
  from?: string;
  payload?: Record<string, unknown> | RTCIceCandidateInit | SessionDescriptionPayload | null;
}

// 事件总线类型定义
type Events = {
  open: undefined;
  close: { code: number; reason?: string };
  message: SignalMessage;
  error: Error;
};

// 信令客户端：负责 WS 连接、重连与消息队列
export class SignalingClient {
  private token: string;
  private ws: WebSocket | null = null;
  private emitter = mitt<Events>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private pendingMessages: SignalMessage[] = [];
  private static readonly MAX_PENDING_MESSAGES = 50;

  constructor(token: string) {
    this.token = token;
  }

  // 建立连接
  connect() {
    if (this.ws) {
      return;
    }

    this.shouldReconnect = true;
    this.openSocket();
  }

  // 连接恢复后，补发队列消息
  private flushPendingMessages() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const queue = [...this.pendingMessages];
    this.pendingMessages = [];
    for (let index = 0; index < queue.length; index += 1) {
      const message = queue[index];
      try {
        this.ws?.send(JSON.stringify(message));
      } catch (error) {
        console.warn("Failed to flush signaling message", error);
        const remaining = queue.slice(index);
        this.pendingMessages = remaining.concat(this.pendingMessages);
        try {
          this.ws?.close();
        } catch (closeError) {
          console.warn("Failed to close signaling socket after flush error", closeError);
        }
        break;
      }
    }
  }

  // 打开 WebSocket 连接并绑定事件
  private openSocket() {
    if (this.ws) {
      return;
    }
    // Include token as query parameter for authorization
    const wsUrlWithAuth = `${WS_URL}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(wsUrlWithAuth);

    this.ws.onopen = () => {
      this.emitter.emit("open", undefined);
      this.flushPendingMessages();
    };

    this.ws.onclose = (event) => {
      this.emitter.emit("close", { code: event.code, reason: event.reason });
      this.cleanup();
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.openSocket(), 3000);
      }
    };

    this.ws.onerror = (e) => {
      const error = e as unknown as Error;
      this.emitter.emit("error", error);
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed: SignalMessage = JSON.parse(event.data);
        this.emitter.emit("message", parsed);
      } catch (err) {
        this.emitter.emit("error", err as Error);
      }
    };
  }

  // 发送信令消息（断线时进入队列）
  send(message: SignalMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.pendingMessages.length >= SignalingClient.MAX_PENDING_MESSAGES) {
        throw new Error("signaling queue overflow");
      }
      this.pendingMessages.push(message);
      if (!this.ws && this.shouldReconnect) {
        this.openSocket();
      }
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  // 主动断开连接并清理
  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.cleanup();
    }
    this.pendingMessages = [];
  }

  // 订阅事件
  on<T extends keyof Events>(event: T, handler: (value: Events[T]) => void) {
    this.emitter.on(event, handler);
  }

  // 取消订阅
  off<T extends keyof Events>(event: T, handler: (value: Events[T]) => void) {
    this.emitter.off(event, handler);
  }

  // 清理 WebSocket 句柄
  private cleanup() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws = null;
    }
  }
}
