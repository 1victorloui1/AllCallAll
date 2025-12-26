import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useAuthContext } from "../context/AuthContext";
import { fetchCallLogs, CallLog } from "../api/callLogs";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useLanguage } from "../context/LanguageContext";

type Props = NativeStackScreenProps<RootStackParamList, "CallLogs">;

const CallLogsScreen: React.FC<Props> = () => {
  const { token } = useAuthContext();
  const { t } = useLanguage();
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      setLoading(true);
      const data = await fetchCallLogs(token, 100);
      setLogs(data);
    } catch (error) {
      console.error(error);
      Alert.alert(t("error_title"), t("call_logs_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const formatTime = useCallback((value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }, []);

  const getTypeLabel = useCallback((log: CallLog) => {
    if (log.direction === "outgoing") {
      return t("call_logs_outgoing");
    }
    if (log.status === "answered") {
      return t("call_logs_answered");
    }
    return t("call_logs_missed");
  }, [t]);

  const renderItem = useCallback(
    ({ item }: { item: CallLog }) => {
      const name = item.peer_display_name?.trim() || item.peer_email;
      const timeLabel = formatTime(item.started_at || item.created_at);
      return (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.type}>{getTypeLabel(item)}</Text>
          </View>
          <Text style={styles.email}>{item.peer_email}</Text>
          <Text style={styles.time}>{timeLabel}</Text>
        </View>
      );
    },
    [formatTime, getTypeLabel]
  );

  const emptyState = useMemo(
    () => (
      <Text style={styles.emptyText}>
        {t("call_logs_empty")}
      </Text>
    ),
    [t]
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadLogs} />
        }
        ListEmptyComponent={!loading ? emptyState : null}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    padding: 20
  },
  listContent: {
    paddingBottom: 20
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827"
  },
  type: {
    fontSize: 12,
    color: "#2563eb",
    fontWeight: "600"
  },
  email: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 6
  },
  time: {
    fontSize: 12,
    color: "#9ca3af"
  },
  emptyText: {
    textAlign: "center",
    color: "#6b7280",
    marginTop: 40
  }
});

export default CallLogsScreen;
