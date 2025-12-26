import { createApiClient } from "./client";

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
