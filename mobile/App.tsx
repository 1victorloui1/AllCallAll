import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "./src/context/AuthContext";
import { LanguageProvider } from "./src/context/LanguageContext";
import { SignalingProvider } from "./src/context/SignalingContext";
import AppNavigator from "./src/navigation/AppNavigator";

const App = () => {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AuthProvider>
          <SignalingProvider>
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
