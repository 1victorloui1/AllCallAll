// API 客户端工厂：统一配置请求基址与认证头
import axios, { AxiosInstance } from "axios";

import { API_BASE_URL, REQUEST_TIMEOUT } from "../config";

// 创建带 Token 的 Axios 实例
export const createApiClient = (token?: string): AxiosInstance => {
  // 基础配置：统一 baseURL 与超时
  const instance = axios.create({
    baseURL: API_BASE_URL,
    timeout: REQUEST_TIMEOUT
  });

  // 请求拦截器：注入鉴权与通用头
  instance.interceptors.request.use((config) => {
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.headers["Content-Type"] = "application/json";
    config.headers["Accept"] = "application/json";
    return config;
  });

  return instance;
};
