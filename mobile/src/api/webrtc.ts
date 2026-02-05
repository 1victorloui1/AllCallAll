// WebRTC 配置 API：从后端获取 ICE/TURN 列表
import { createApiClient } from "./client";

// ICE 服务器结构
type IceServer = {
  urls: string[] | string;
  username?: string;
  credential?: string;
};

// WebRTC 配置响应结构
export interface WebRTCConfigResponse {
  ice_servers: IceServer[];
}

// 获取 WebRTC 配置
export const fetchWebRTCConfig = async (
  token: string
): Promise<WebRTCConfigResponse> => {
  const api = createApiClient(token);
  const { data } = await api.get<WebRTCConfigResponse>("/webrtc/config");
  return data;
};
