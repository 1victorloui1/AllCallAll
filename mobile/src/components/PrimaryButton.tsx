// 通用主按钮组件：统一按钮样式与点击行为
import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  GestureResponderEvent,
  ViewStyle
} from "react-native";

interface Props {
  title: string;
  onPress: (event: GestureResponderEvent) => void;
  style?: ViewStyle;
  disabled?: boolean;
}

// 主按钮组件
const PrimaryButton: React.FC<Props> = ({ title, onPress, style, disabled }) => {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.disabled, style]}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={disabled}
    >
      <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
  );
};

// 样式定义
const styles = StyleSheet.create({
  button: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  disabled: {
    backgroundColor: "#9ca3af"
  },
  text: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600"
  }
});

export default PrimaryButton;
