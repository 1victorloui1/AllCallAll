// 联系人页：联系人管理、在线状态与通话入口
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
  Modal,
  TouchableOpacity
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useAuthContext } from "../context/AuthContext";
import {
  listContacts,
  addContact,
  removeContact,
  fetchPresence,
  User,
  PresenceRecord
} from "../api/users";
import ContactListItem from "../components/ContactListItem";
import PrimaryButton from "../components/PrimaryButton";
import TextField from "../components/TextField";
import PresenceBadge from "../components/PresenceBadge";
import CallOverlay from "../components/CallOverlay";
import { useSignaling } from "../context/SignalingContext";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useLanguage } from "../context/LanguageContext";

// 路由参数类型
type Props = NativeStackScreenProps<RootStackParamList, "Contacts">;

// 联系人页组件
const ContactsScreen: React.FC<Props> = ({ navigation }) => {
  const { user, token, logout } = useAuthContext();
  const { startCall, connectionReady } = useSignaling();
  const { t } = useLanguage();

  // 列表数据与 UI 状态
  const [contacts, setContacts] = useState<User[]>([]);
  const [presence, setPresence] = useState<Record<string, PresenceRecord>>({});
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newContactEmail, setNewContactEmail] = useState("");

  // 拉取联系人列表
  const loadContacts = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      setLoadingContacts(true);
      const data = await listContacts(token);
      setContacts(data);
    } catch (error) {
      console.error(error);
      Alert.alert(t("error_title"), t("contacts_reload_failed"));
    } finally {
      setLoadingContacts(false);
    }
  }, [t, token]);

  // 拉取在线状态
  const loadPresence = useCallback(async () => {
    if (!token) {
      return;
    }
    const emails = [user?.email, ...contacts.map((c) => c.email)].filter(
      Boolean
    ) as string[];

    if (!emails.length) {
      return;
    }

    try {
      const presenceList = await fetchPresence(token, emails);
      const map: Record<string, PresenceRecord> = {};
      presenceList.forEach((record) => {
        map[record.email] = record;
      });
      setPresence(map);
    } catch (error) {
      console.warn("presence load failed", error);
    }
  }, [contacts, token, user?.email]);

  // 首次进入加载联系人
  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // 定时刷新在线状态
  useEffect(() => {
    const interval = setInterval(loadPresence, 10000);
    return () => clearInterval(interval);
  }, [loadPresence]);

  // 联系人变化时刷新在线状态
  useEffect(() => {
    loadPresence();
  }, [contacts, loadPresence]);

  // 下拉刷新
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadContacts();
    await loadPresence();
    setRefreshing(false);
  }, [loadContacts, loadPresence]);

  // 添加联系人
  const handleAddContact = useCallback(async () => {
    if (!token) {
      return;
    }
    const target = newContactEmail.trim().toLowerCase();
    if (!target) {
      return;
    }

    try {
      await addContact(token, target);
      setNewContactEmail("");
      setAddModalVisible(false);
      await loadContacts();
      await loadPresence();
      Alert.alert(t("success_title"), t("contacts_add_success", { email: target }));
    } catch (error) {
      console.error(error);
      Alert.alert(t("error_title"), t("contacts_add_failed"));
    }
  }, [loadContacts, loadPresence, newContactEmail, t, token]);

  // 删除联系人
  const handleRemoveContact = useCallback(
    (contact: User) => {
      Alert.alert(
        t("contacts_remove_title"),
        t("contacts_remove_confirm", {
          name: contact.display_name || contact.email
        }),
        [
          { text: t("cancel"), style: "cancel" },
          {
            text: t("contact_remove"),
            style: "destructive",
            onPress: async () => {
              if (!token) return;
              try {
                await removeContact(token, contact.id);
                await loadContacts();
                await loadPresence();
              } catch (error) {
                console.error(error);
                Alert.alert(t("error_title"), t("contacts_remove_failed"));
              }
            }
          }
        ]
      );
    },
    [loadContacts, loadPresence, t, token]
  );

  // 发起通话（需要信令连接可用）
  const handleStartCall = useCallback(
    (email: string) => {
      if (!connectionReady) {
        Alert.alert(
          t("contacts_signal_unavailable_title"),
          t("contacts_signal_unavailable_message")
        );
        return;
      }
      startCall(email);
    },
    [connectionReady, startCall, t]
  );

  // 进入聊天页面
  const handleOpenChat = useCallback(
    (contact: User) => {
      navigation.navigate("Chat", {
        peerEmail: contact.email,
        peerName: contact.display_name || contact.email
      });
    },
    [navigation]
  );

  // 联系人排序（按显示名/邮箱）
  const sortedContacts = useMemo(
    () =>
      [...contacts].sort((a, b) =>
        (a.display_name || a.email).localeCompare(
          b.display_name || b.email,
          "en"
        )
      ),
    [contacts]
  );

  return (
    <View style={styles.container}>
      {/* 顶部用户信息与快捷入口 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            {t("contacts_greeting", { name: user?.display_name || "" })}
          </Text>
          <Text style={styles.subtitle}>{user?.email}</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.callLogsButton}
            onPress={() => navigation.navigate("CallLogs")}
          >
            <Text style={styles.callLogsText}>{t("contacts_call_logs")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.changePasswordButton}
            onPress={() => navigation.navigate("ChangePassword")}
          >
            <Text style={styles.changePasswordText}>
              {t("contacts_change_password")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>{t("contacts_logout")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 自己的在线状态 */}
      <View style={styles.presenceCard}>
        <Text style={styles.sectionTitle}>{t("contacts_presence_title")}</Text>
        <PresenceBadge
          online={presence[user?.email ?? ""]?.online ?? false}
          lastSeen={presence[user?.email ?? ""]?.last_seen ?? null}
        />
      </View>

      {/* 联系人区标题与添加按钮 */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("contacts_title")}</Text>
        <PrimaryButton
          title={t("contacts_add_button")}
          onPress={() => setAddModalVisible(true)}
          style={styles.addButton}
        />
      </View>

      {/* 联系人列表 */}
      <FlatList
        data={sortedContacts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <ContactListItem
            contact={item}
            presence={presence[item.email]}
            onCall={handleStartCall}
            onMessage={handleOpenChat}
            onRemove={handleRemoveContact}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !loadingContacts ? (
            <Text style={styles.emptyText}>
              {t("contacts_empty")}
            </Text>
          ) : null
        }
      />

      {/* 添加联系人弹窗 */}
      <Modal
        visible={isAddModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t("contacts_add_title")}</Text>
            <TextField
              label={t("contacts_add_email_label")}
              autoCapitalize="none"
              keyboardType="email-address"
              value={newContactEmail}
              onChangeText={setNewContactEmail}
            />
            <PrimaryButton title={t("contacts_add_confirm")} onPress={handleAddContact} />
            <PrimaryButton
              title={t("cancel")}
              onPress={() => setAddModalVisible(false)}
              style={styles.modalCancel}
            />
          </View>
        </View>
      </Modal>

      {/* 通话悬浮层 */}
      <CallOverlay />
    </View>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    paddingTop: 48,
    paddingHorizontal: 20
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24
  },
  greeting: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827"
  },
  subtitle: {
    marginTop: 4,
    color: "#6b7280"
  },
  headerButtons: {
    gap: 8
  },
  callLogsButton: {
    backgroundColor: "#111827",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10
  },
  callLogsText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12
  },
  changePasswordButton: {
    backgroundColor: "#3b82f6",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10
  },
  changePasswordText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12
  },
  logoutButton: {
    backgroundColor: "#e5e7eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10
  },
  logoutText: {
    color: "#111827",
    fontWeight: "600"
  },
  presenceCard: {
    backgroundColor: "#fff",
    padding: 18,
    borderRadius: 16,
    marginBottom: 24
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827"
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  listContent: {
    paddingBottom: 140
  },
  emptyText: {
    textAlign: "center",
    color: "#6b7280",
    marginTop: 40
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    paddingHorizontal: 20
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16
  },
  modalCancel: {
    marginTop: 12,
    backgroundColor: "#9ca3af"
  }
});

export default ContactsScreen;
