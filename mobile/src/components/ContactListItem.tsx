// 联系人列表项：展示用户信息与操作按钮
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

import { User } from "../api/users";
import PresenceBadge from "./PresenceBadge";
import { useLanguage } from "../context/LanguageContext";

// 组件参数类型
interface Props {
  contact: User;
  presence?: {
    online: boolean;
    last_seen?: string | null;
  };
  onCall: (email: string) => void;
  onMessage: (contact: User) => void;
  onRemove: (contact: User) => void;
}

// 联系人条目组件
const ContactListItem: React.FC<Props> = ({
  contact,
  presence,
  onCall,
  onMessage,
  onRemove
}) => {
  const { t } = useLanguage();

  return (
    <View style={styles.container}>
      {/* 基本信息区 */}
      <View style={styles.info}>
        <Text style={styles.name}>{contact.display_name || contact.email}</Text>
        <Text style={styles.email}>{contact.email}</Text>
        <PresenceBadge
          online={presence?.online ?? false}
          lastSeen={presence?.last_seen ?? null}
        />
      </View>
      {/* 操作按钮区 */}
      <View style={styles.actions}>
        <View style={styles.actionColumn}>
          <TouchableOpacity
            style={[styles.button, styles.call]}
            onPress={() => onCall(contact.email)}
          >
            <Text style={styles.buttonText}>{t("contact_call")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.message]}
            onPress={() => onMessage(contact)}
          >
            <Text style={styles.buttonText}>{t("contact_message")}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.button, styles.remove]}
          onPress={() => onRemove(contact)}
        >
          <Text style={styles.buttonText}>{t("contact_remove")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 2
  },
  info: {
    marginBottom: 12
  },
  name: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827"
  },
  email: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 6
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  actionColumn: {
    flex: 1,
    gap: 8,
    marginRight: 12
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10
  },
  call: {
    backgroundColor: "#2563eb"
  },
  message: {
    backgroundColor: "#0ea5e9"
  },
  remove: {
    backgroundColor: "#dc2626"
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
  }
});

export default ContactListItem;
