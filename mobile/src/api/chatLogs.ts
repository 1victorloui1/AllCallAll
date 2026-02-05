// 聊天记录 API：获取与指定用户的历史消息
import { createApiClient } from "./client";

// 聊天记录结构
export interface ChatLog {
  id: number;
  sender_email: string;
  sender_display_name?: string;
  receiver_email: string;
  receiver_display_name?: string;
  body: string;
  sent_at: string;
  created_at: string;
  direction: "incoming" | "outgoing";
}

// 获取聊天记录（默认 50 条）
export const fetchChatLogs = async (
  token: string,
  peerEmail: string,
  limit = 50
) => {
  const api = createApiClient(token);
  const response = await api.get<{ chat_logs: ChatLog[] }>(
    "/users/chat-logs",
    {
      params: {
        peer_email: peerEmail,
        limit
      }
    }
  );
  return response.data.chat_logs;
};
