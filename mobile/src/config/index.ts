// 运行时配置入口：根据环境选择 API/WS 地址与超时配置
import { Platform } from "react-native";
import * as Device from "expo-device";

// 开发环境（本地）
const DEV_API = {
  HTTP: "http://192.168.31.217:8080",
  WS: "ws://192.168.31.217:8080"
};

// 生产环境（云服务器）
const PROD_API = {
  HTTP: "https://allcall.cn", // 使用你的域名或直接用 IP
  WS: "wss://allcall.cn"      // 必须是 wss://（安全 WebSocket）
};

// 或者使用公网 IP（暂时）
const PROD_API_IP = {
  HTTP: "http://47.109.183.99",
  WS: "ws://47.109.183.99"
};

// 根据构建环境选择配置
const __DEV__ = false; // 在构建时修改为 false（生产环境）

// 选择最终使用的 API 配置
const API_CONFIG = __DEV__ ? DEV_API : PROD_API_IP;

// 标记是否为真机 Android（便于调试或条件判断）
const isPhysicalAndroid = Platform.OS === "android" && Device.isDevice;

// 拼接最终的 API 与 WS 地址
const API_HOST = API_CONFIG.HTTP;
const WS_HOST = API_CONFIG.WS;

// 导出 API 常量
export const API_BASE_URL = `${API_HOST}/api/v1`;
export const WS_URL = `${WS_HOST}/api/v1/ws`;
export const REQUEST_TIMEOUT = 10_000;
