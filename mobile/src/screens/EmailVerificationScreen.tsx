// 邮箱验证码页面：发送验证码与校验流程
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import TextField from "../components/TextField";
import PrimaryButton from "../components/PrimaryButton";
import VerificationCodeInput from "../components/VerificationCodeInput";
import { sendVerificationCode, verifyCode } from "../api/email";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useLanguage } from "../context/LanguageContext";

type Props = NativeStackScreenProps<RootStackParamList, "EmailVerification">;

/**
 * 邮箱验证屏幕
 * 两步流程：1. 输入邮箱 2. 输入验证码
 */
const EmailVerificationScreen: React.FC<Props> = ({ navigation, route }) => {
  const { email: initialEmail, onVerified } = route.params || {};
  const { t } = useLanguage();

  // ... 现有代码 ...

  // UI 状态
  const [step, setStep] = useState<"input" | "verify">("input");
  const [email, setEmail] = useState(initialEmail || "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 倒计时逻辑
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  /**
   * 发送验证码
   */
  const handleSendCode = async () => {
    try {
      // 基础验证
      if (!email.trim()) {
        Alert.alert(t("error_title"), t("register_error_missing_email"));
        return;
      }

      // 邮箱格式验证
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        Alert.alert(t("error_title"), t("register_error_invalid_email"));
        return;
      }

      setLoading(true);
      await sendVerificationCode(email.trim().toLowerCase());

      Alert.alert(t("success_title"), t("verify_send_success"));
      setStep("verify");
      setCountdown(60); // 60秒倒计时
    } catch (error) {
      console.error("Send code error:", error);
      Alert.alert(t("error_title"), t("verify_send_failed"));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 验证码校验
   */
  const handleVerifyCode = async (inputCode?: string) => {
    try {
      const value = (inputCode ?? code).trim();
      if (value.length !== 6) {
        Alert.alert(t("error_title"), t("verify_code_required"));
        return;
      }

      setLoading(true);
      await verifyCode(email.trim().toLowerCase(), value);

      Alert.alert(t("success_title"), t("verify_success"));

      // 如果是从注册流程来的，需要调用 onVerified 回调并完成注册
      if (onVerified) {
        // 从注册流程来，第二步是提供注册信息
        navigation.navigate("Register", { email: email.trim().toLowerCase() });
      } else {
        // 单纯邮箱验证流程，正常返回
        navigation.goBack();
      }
    } catch (error) {
      console.error("Verify code error:", error);
      Alert.alert(t("error_title"), t("verify_failed"));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 重新发送验证码
   */
  const handleResendCode = async () => {
    try {
      setResendLoading(true);
      await sendVerificationCode(email.trim().toLowerCase());
      Alert.alert(t("success_title"), t("verify_resend_success"));
      setCountdown(60);
      setCode(""); // 清空之前输入的code
    } catch (error) {
      console.error("Resend code error:", error);
      Alert.alert(t("error_title"), t("verify_resend_failed"));
    } finally {
      setResendLoading(false);
    }
  };

  // 第一步：邮箱输入
  if (step === "input") {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 标题与说明 */}
          <View style={styles.header}>
            <Text style={styles.title}>{t("verify_title")}</Text>
            <Text style={styles.subtitle}>{t("verify_subtitle")}</Text>
          </View>

          {/* 邮箱输入与发送按钮 */}
          <View style={styles.form}>
            <TextField
              label={t("register_email_label")}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="example@email.com"
              editable={!loading}
            />

            <PrimaryButton
              title={loading ? t("verify_send_loading") : t("verify_send_code")}
              onPress={handleSendCode}
              disabled={loading || !email.trim()}
            />

            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.linkButton}
              disabled={loading}
            >
              <Text style={styles.linkText}>{t("verify_back")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // 第二步：验证码输入
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 标题与提示 */}
        <View style={styles.header}>
          <Text style={styles.title}>{t("verify_title_code")}</Text>
          <Text style={styles.subtitle}>
            {t("verify_subtitle_code", { email })}
          </Text>
        </View>

        {/* 验证码输入与确认按钮 */}
        <View style={styles.form}>
          <VerificationCodeInput
            codeLength={6}
            onCodeChange={setCode}
            onCodeComplete={(value) => {
              setCode(value);
              handleVerifyCode(value);
            }}
            editable={!loading}
          />

          <PrimaryButton
            title={loading ? t("verify_loading") : t("verify_button")}
            onPress={() => handleVerifyCode()}
            disabled={loading || code.length !== 6}
          />

          {/* 重新发送逻辑：倒计时 or 按钮 */}
          <View style={styles.resendContainer}>
            {countdown > 0 ? (
              <Text style={styles.countdownText}>
                {t("verify_resend_countdown", { seconds: countdown })}
              </Text>
            ) : (
              <TouchableOpacity
                onPress={handleResendCode}
                disabled={resendLoading}
              >
                {resendLoading ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : (
                  <Text style={styles.resendText}>{t("verify_resend")}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            onPress={() => setStep("input")}
            style={styles.linkButton}
            disabled={loading}
          >
            <Text style={styles.linkText}>{t("verify_change_email")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 36,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1f2937",
  },
  subtitle: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
  },
  form: {
    flex: 1,
  },
  resendContainer: {
    alignItems: "center",
    marginVertical: 20,
  },
  countdownText: {
    fontSize: 14,
    color: "#6b7280",
  },
  resendText: {
    fontSize: 14,
    color: "#2563eb",
    fontWeight: "600",
  },
  linkButton: {
    marginTop: 16,
    alignItems: "center",
  },
  linkText: {
    color: "#2563eb",
    fontWeight: "600",
    fontSize: 14,
  },
});

export default EmailVerificationScreen;
