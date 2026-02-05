// 应用入口：装配全局 Provider 与导航容器
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "./src/context/AuthContext";
import { LanguageProvider } from "./src/context/LanguageContext";
import { SignalingProvider } from "./src/context/SignalingContext";
import AppNavigator from "./src/navigation/AppNavigator";

// 根组件：组合安全区、语言、认证、信令与导航
const App = () => {
  return (
    <SafeAreaProvider>
      {/* 全局语言状态 */}
      <LanguageProvider>
        {/* 全局登录态 */}
        <AuthProvider>
          {/* 全局信令与通话状态 */}
          <SignalingProvider>
            {/* 导航容器 */}
            <NavigationContainer>
              <AppNavigator />
              <StatusBar style="auto" />
            </NavigationContainer>
          </SignalingProvider>
        </AuthProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
};

export default App;
