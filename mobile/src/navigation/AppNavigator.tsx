// 路由入口：根据登录态切换导航栈
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";

import { useAuthContext } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import EmailVerificationScreen from "../screens/EmailVerificationScreen";
import ContactsScreen from "../screens/ContactsScreen";
import ChangePasswordScreen from "../screens/ChangePasswordScreen";
import CallLogsScreen from "../screens/CallLogsScreen";
import ChatScreen from "../screens/ChatScreen";
import CallRecordingDetailScreen from "../screens/CallRecordingDetailScreen";

// 路由参数类型定义
export type RootStackParamList = {
  Login: undefined;
  Register: { email?: string };
  EmailVerification: { email?: string; onVerified?: () => void };
  Contacts: undefined;
  ChangePassword: undefined;
  CallLogs: undefined;
  CallRecordingDetail: { callId: string };
  Chat: { peerEmail: string; peerName?: string };
};

// 创建原生栈导航器
const Stack = createNativeStackNavigator<RootStackParamList>();

// 启动时的加载占位
const LoadingFallback = () => (
  <View
    style={{
      flex: 1,
      justifyContent: "center",
      alignItems: "center"
    }}
  >
    <ActivityIndicator size="large" />
  </View>
);

// App 导航组件：根据 token 决定进入登录或主界面
const AppNavigator: React.FC = () => {
  const { token, loading } = useAuthContext();
  const { t } = useLanguage();

  // 等待本地登录态加载完成
  if (loading) {
    return <LoadingFallback />;
  }

  return (
    <Stack.Navigator>
      {/* 已登录：主功能页面 */}
      {token ? (
        <>
          <Stack.Screen
            name="Contacts"
            component={ContactsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ChangePassword"
            component={ChangePasswordScreen}
            options={{ title: t("change_password_title") }}
          />
          <Stack.Screen
            name="CallLogs"
            component={CallLogsScreen}
            options={{ title: t("call_logs_title") }}
          />
          <Stack.Screen
            name="CallRecordingDetail"
            component={CallRecordingDetailScreen}
            options={{ title: t("recording_detail_nav_title") }}
          />
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        /* 未登录：认证流程页面 */
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: t("login_nav_title") }}
          />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: t("register_nav_title") }}
          />
          <Stack.Screen
            name="EmailVerification"
            component={EmailVerificationScreen}
            options={{ title: t("verify_nav_title") }}
          />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;
