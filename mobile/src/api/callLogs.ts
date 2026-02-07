// 通话记录 API：获取历史通话列表
import { createApiClient } from "./client";

// 通话记录结构
export interface CallLog {
  id: number;
  call_id: string;
  peer_email: string;
  peer_display_name: string;
  direction: "outgoing" | "incoming";
  status: "pending" | "answered" | "missed";
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  recording_status?: string;
  recording_available?: boolean;
}

// 获取通话记录（默认 50 条）
export const fetchCallLogs = async (token: string, limit = 50) => {
  const api = createApiClient(token);
  const response = await api.get<{ call_logs: CallLog[] }>("/users/call-logs", {
    params: { limit }
  });
  return response.data.call_logs;
};
