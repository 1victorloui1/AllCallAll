// 在线状态徽标：显示在线/离线与最后在线时间
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLanguage } from "../context/LanguageContext";

// 组件参数类型
interface Props {
  online: boolean;
  lastSeen?: string | null;
}

// 在线状态显示组件
const PresenceBadge: React.FC<Props> = ({ online, lastSeen }) => {
  const { t } = useLanguage();
  return (
    <View style={styles.container}>
      <View style={[styles.dot, online ? styles.online : styles.offline]} />
      <Text style={styles.text}>
        {online
          ? t("presence_online")
          : lastSeen
          ? t("presence_offline_time", {
              time: new Date(lastSeen).toLocaleString()
            })
          : t("presence_offline")}
      </Text>
    </View>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center"
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6
  },
  online: {
    backgroundColor: "#22c55e"
  },
  offline: {
    backgroundColor: "#9ca3af"
  },
  text: {
    fontSize: 12,
    color: "#4b5563"
  }
});

export default PresenceBadge;
