import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import TextField from "../components/TextField";
import PrimaryButton from "../components/PrimaryButton";
import { useAuthContext } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/AppNavigator";
import { changePassword, ChangePasswordRequest } from "../api/users";
import { useLanguage } from "../context/LanguageContext";

type Props = NativeStackScreenProps<RootStackParamList, "ChangePassword">;

interface PasswordValidation {
  isValid: boolean;
  errors: string[];
}

const validatePassword = (
  password: string,
  t: (key: string) => string
): PasswordValidation => {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push(t("password_error_short"));
  }
  if (password.length > 128) {
    errors.push(t("password_error_long"));
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  // 检查是否仅包含字母和数字（不允许空格或特殊字符）
  const onlyLettersAndDigits = /^[a-zA-Z0-9]*$/.test(password);

  if (!hasLetter) {
    errors.push(t("password_error_letter"));
  }
  if (!hasDigit) {
    errors.push(t("password_error_digit"));
  }
  if (!onlyLettersAndDigits && password.length > 0) {
    errors.push(t("password_error_special"));
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const ChangePasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { token } = useAuthContext();
  const { t } = useLanguage();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // 检查 token 是否存在，如果不存在则跳转回登陆
  React.useEffect(() => {
    if (!token) {
      Alert.alert(t("auth_expired_title"), t("auth_expired_body"));
      navigation.goBack();
    }
  }, [navigation, t, token]);

  const newPasswordValidation = useMemo(
    () => validatePassword(newPassword, t),
    [newPassword, t]
  );
  const passwordsMatch = newPassword === confirmPassword && newPassword !== "";
  const isFormValid =
    oldPassword.length > 0 &&
    newPasswordValidation.isValid &&
    passwordsMatch;

  const handleChangePassword = async () => {
    if (!isFormValid) {
      Alert.alert(
        t("change_password_form_error_title"),
        t("change_password_form_error_body")
      );
      return;
    }

    try {
      setLoading(true);

      const request: ChangePasswordRequest = {
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      };

      await changePassword(token || "", request);

      Alert.alert(
        t("change_password_success_title"),
        t("change_password_success_body"),
        [
          {
            text: t("confirm"),
            onPress: () => navigation.goBack()
          }
        ]
      );
    } catch (error) {
      Alert.alert(
        t("change_password_failed_title"),
        t("change_password_failed_body")
      );
      console.error("Change password error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("change_password_title")}</Text>
          <Text style={styles.subtitle}>{t("change_password_subtitle")}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>{t("change_password_old_label")}</Text>
            <TextField
              placeholder={t("change_password_old_placeholder")}
              secureTextEntry={!showPassword}
              value={oldPassword}
              onChangeText={setOldPassword}
            />
            {oldPassword.length === 0 && (
              <Text style={styles.helperText}>{t("change_password_required")}</Text>
            )}
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>{t("change_password_new_label")}</Text>
            <TextField
              placeholder={t("change_password_new_placeholder")}
              secureTextEntry={!showPassword}
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <Text style={styles.helperText}>
              {t("change_password_rules")}
            </Text>

            {newPassword.length > 0 && (
              <View style={styles.validationContainer}>
                {newPasswordValidation.errors.map((error, index) => (
                  <View key={index} style={styles.errorItem}>
                    <Text style={styles.errorText}>✗ {error}</Text>
                  </View>
                ))}
                {newPasswordValidation.isValid && (
                  <View style={styles.successItem}>
                    <Text style={styles.successText}>
                      {t("change_password_valid")}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>{t("change_password_confirm_label")}</Text>
            <TextField
              placeholder={t("change_password_confirm_placeholder")}
              secureTextEntry={!showPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            {confirmPassword.length > 0 && newPassword.length > 0 && (
              <>
                {passwordsMatch ? (
                  <Text style={styles.successText}>
                    {t("change_password_match")}
                  </Text>
                ) : (
                  <Text style={styles.errorText}>
                    {t("change_password_mismatch")}
                  </Text>
                )}
              </>
            )}
          </View>

          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            style={styles.toggleButton}
          >
            <Text style={styles.toggleText}>
              {showPassword ? t("change_password_hide") : t("change_password_show")}
            </Text>
          </TouchableOpacity>

          <PrimaryButton
            title={loading ? t("change_password_loading") : t("change_password_button")}
            onPress={handleChangePassword}
            disabled={!isFormValid || loading}
          />

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>{t("change_password_cancel")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb"
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24
  },
  header: {
    marginBottom: 32
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1f2937"
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20
  },
  form: {
    marginBottom: 32
  },
  fieldContainer: {
    marginBottom: 24
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280"
  },
  validationContainer: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 6
  },
  errorItem: {
    marginVertical: 4
  },
  errorText: {
    fontSize: 12,
    color: "#dc2626"
  },
  successItem: {
    marginVertical: 4
  },
  successText: {
    fontSize: 12,
    color: "#16a34a"
  },
  toggleButton: {
    paddingVertical: 8,
    marginBottom: 16
  },
  toggleText: {
    color: "#2563eb",
    fontSize: 14,
    fontWeight: "500"
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: "center"
  },
  cancelText: {
    color: "#6b7280",
    fontSize: 16,
    fontWeight: "600"
  }
});

export default ChangePasswordScreen;
