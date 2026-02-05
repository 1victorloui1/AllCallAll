// 登录态与用户信息的全局状态管理（含持久化）
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import * as authApi from "../api/auth";
import * as usersApi from "../api/users";
import { User } from "../api/users";

// 本地持久化使用的存储 Key
const STORAGE_KEY = "allcallall.auth";

// Context 内部状态结构
interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
}

// Context 对外暴露的能力
interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  logout: () => Promise<void>;
}

// 创建 AuthContext
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  // 初始化登录态（默认 loading=true，等待读取本地缓存）
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    loading: true
  });

  // 启动时从本地缓存恢复登录态
  const bootstrap = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }
      const parsed = JSON.parse(stored) as { token: string; user: User };
      setState({
        token: parsed.token,
        user: parsed.user,
        loading: false
      });
    } catch (error) {
      console.warn("Failed to load auth state", error);
      setState((current) => ({ ...current, loading: false }));
    }
  }, []);

  // App 启动时执行一次
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // 持久化登录态（用于登录/注册成功后）
  const persistState = useCallback(async (token: string, user: User) => {
    setState({ token, user, loading: false });
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token, user })
    );
  }, []);

  // 清理登录态（用于退出登录）
  const clearState = useCallback(async () => {
    setState({ token: null, user: null, loading: false });
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  // 登录：调用 API 并落盘保存
  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login(email, password);
      await persistState(response.access_token, response.user);
    },
    [persistState]
  );

  // 注册：调用 API 并落盘保存
  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const response = await authApi.register({
        email,
        password,
        display_name: displayName
      });
      await persistState(response.access_token, response.user);
    },
    [persistState]
  );

  // 退出登录：清理缓存
  const logout = useCallback(async () => {
    await clearState();
  }, [clearState]);

  // 将状态与操作方法组合为 Context 值
  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout
    }),
    [state, login, register, logout]
  );

  // 提供全局 AuthContext
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// 简化使用的 Hook
export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return ctx;
};
