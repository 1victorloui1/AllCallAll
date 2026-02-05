// 登录与注册相关的 API 请求封装
import { createApiClient } from "./client";

// 登录/注册接口返回的数据结构
export interface AuthResponse {
  user: {
    id: number;
    email: string;
    display_name: string;
  };
  access_token: string;
}

// 注册请求体结构
export interface RegisterPayload {
  email: string;
  password: string;
  display_name: string;
}

// 调用注册接口
export const register = async (payload: RegisterPayload) => {
  const api = createApiClient();
  const response = await api.post<AuthResponse>("/auth/register", payload);
  return response.data;
};

// 调用登录接口
export const login = async (email: string, password: string) => {
  const api = createApiClient();
  const response = await api.post<AuthResponse>("/auth/login", {
    email,
    password
  });
  return response.data;
};
