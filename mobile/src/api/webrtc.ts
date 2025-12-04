import { createApiClient } from "./client";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface WebRTCConfigResponse {
  ice_servers: IceServer[];
}

export const fetchWebRTCConfig = async (
  token: string
): Promise<WebRTCConfigResponse> => {
  const client = createApiClient(token);
  const response = await client.get<WebRTCConfigResponse>("/webrtc/config");
  return response.data;
};
