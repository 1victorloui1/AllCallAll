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

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { login } = useAuthContext();
  const { t, language, setLanguage } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      await login(email.trim(), password);
    } catch (error) {
      console.error(error);
      Alert.alert(t("login_failed_title"), t("login_failed_message"));
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
        <View style={styles.titleRow}>
          <Text style={styles.title}>AllCallAll</Text>
          <View style={styles.languageToggle}>
            <TouchableOpacity
              style={[
                styles.languageButton,
                language === "zh" ? styles.languageButtonActive : null
              ]}
              onPress={() => setLanguage("zh")}
            >
              <Text
                style={[
                  styles.languageText,
                  language === "zh" ? styles.languageTextActive : null
                ]}
              >
                {t("language_zh")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.languageButton,
                language === "en" ? styles.languageButtonActive : null
              ]}
              onPress={() => setLanguage("en")}
            >
              <Text
                style={[
                  styles.languageText,
                  language === "en" ? styles.languageTextActive : null
                ]}
              >
                {t("language_en")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.subtitle}>{t("login_subtitle")}</Text>
      </View>
      <View style={styles.form}>
        <TextField
          label={t("login_email_label")}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          label={t("login_password_label")}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <PrimaryButton
          title={loading ? t("login_loading") : t("login_button")}
          onPress={handleLogin}
          disabled={loading}
        />
        <TouchableOpacity
          onPress={() => navigation.navigate("Register", {})}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>{t("login_signup")}</Text>
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#1f2937"
  },
  languageToggle: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderRadius: 14,
    padding: 4
  },
  languageButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12
  },
  languageButtonActive: {
    backgroundColor: "#111827"
  },
  languageText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151"
  },
  languageTextActive: {
    color: "#fff"
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

export default LoginScreen;
