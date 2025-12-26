import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import TextField from "../components/TextField";
import PrimaryButton from "../components/PrimaryButton";
import { useAuthContext } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useLanguage } from "../context/LanguageContext";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

const RegisterScreen: React.FC<Props> = ({ navigation, route }) => {
  const { register } = useAuthContext();
  const { t } = useLanguage();
  // 如果来自邮箱验证页面，会有预填的 email
  const { email: prefilledEmail } = route.params || {};
  
  const [email, setEmail] = useState(prefilledEmail || "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    try {
      // 验证输入
      if (!email.trim()) {
        Alert.alert(t("error_title"), t("register_error_missing_email"));
        return;
      }

      // 基础邮箱格式验证
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        Alert.alert(t("error_title"), t("register_error_invalid_email"));
        return;
      }

      if (!password.trim()) {
        Alert.alert(t("error_title"), t("register_error_missing_password"));
        return;
      }
      if (password.length < 8) {
        Alert.alert(t("error_title"), t("register_error_password_short"));
        return;
      }
      if (!displayName.trim()) {
        Alert.alert(t("error_title"), t("register_error_missing_name"));
        return;
      }

      // 判断是否已验证邮箱
      if (prefilledEmail) {
        // 邮箱已验证，直接调用注册
        setLoading(true);
        await register(email.trim().toLowerCase(), password, displayName.trim());
        // 注册成功后会自动跳转到主屏幕
      } else {
        // 邮箱未验证，先跳转到验证页面
        navigation.navigate("EmailVerification", {
          email: email.trim().toLowerCase(),
          onVerified: async () => {
            // 验证完成后的回调
          }
        });
      }
    } catch (error) {
      console.error("Register error:", error);
      Alert.alert(t("error_title"), t("register_error_check_input"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t("register_title")}</Text>
        <Text style={styles.subtitle}>{t("register_subtitle")}</Text>
      </View>
      <View style={styles.form}>
        <TextField
          label={t("register_display_name_label")}
          autoCapitalize="words"
          value={displayName}
          onChangeText={setDisplayName}
          editable={!loading}
        />
        <TextField
          label={t("register_email_label")}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!loading && !prefilledEmail}  // 邮箱已验证时禁用编辑
        />
        <TextField
          label={t("register_password_label")}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />
        <PrimaryButton
          title={loading ? t("register_loading") : t("register_button")}
          onPress={handleRegister}
          disabled={loading}
        />
        <TouchableOpacity
          onPress={() => navigation.pop()}
          style={styles.linkButton}
          disabled={loading}
        >
          <Text style={styles.linkText}>{t("register_already")}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 24,
    paddingTop: 48
  },
  header: {
    marginBottom: 36
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1f2937"
  },
  subtitle: {
    marginTop: 12,
    fontSize: 16,
    color: "#6b7280",
    lineHeight: 22
  },
  form: {
    flex: 1
  },
  linkButton: {
    marginTop: 16,
    alignItems: "center"
  },
  linkText: {
    color: "#2563eb",
    fontWeight: "600"
  }
});

export default RegisterScreen;
