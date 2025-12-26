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

export type RootStackParamList = {
  Login: undefined;
  Register: { email?: string };
  EmailVerification: { email?: string; onVerified?: () => void };
  Contacts: undefined;
  ChangePassword: undefined;
  CallLogs: undefined;
  Chat: { peerEmail: string; peerName?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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

const AppNavigator: React.FC = () => {
  const { token, loading } = useAuthContext();
  const { t } = useLanguage();

  if (loading) {
    return <LoadingFallback />;
  }

  return (
    <Stack.Navigator>
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
            name="Chat"
            component={ChatScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
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
