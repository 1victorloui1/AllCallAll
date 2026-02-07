// 通话记录页：拉取并展示历史通话
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useAuthContext } from "../context/AuthContext";
import { fetchCallLogs, CallLog } from "../api/callLogs";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useLanguage } from "../context/LanguageContext";

// 路由参数类型
type Props = NativeStackScreenProps<RootStackParamList, "CallLogs">;

// 通话记录页组件
const CallLogsScreen: React.FC<Props> = ({ navigation }) => {
  const { token } = useAuthContext();
  const { t } = useLanguage();
  // 列表数据与加载状态
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(false);

  // 拉取通话记录
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

  // 进入页面自动加载
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // 时间格式化
  const formatTime = useCallback((value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }, []);

  // 生成通话类型/状态文案
  const getTypeLabel = useCallback((log: CallLog) => {
    if (log.direction === "outgoing") {
      return t("call_logs_outgoing");
    }
    if (log.status === "answered") {
      return t("call_logs_answered");
    }
    return t("call_logs_missed");
  }, [t]);

  // 录音状态提示
  const getRecordingLabel = useCallback((status?: string) => {
    if (!status) {
      return "";
    }
    if (status === "ready") {
      return t("call_logs_recording_ready");
    }
    if (status === "failed") {
      return t("call_logs_recording_failed");
    }
    return t("call_logs_recording_processing");
  }, [t]);

  // 渲染单条通话记录
  const renderItem = useCallback(
    ({ item }: { item: CallLog }) => {
      const name = item.peer_display_name?.trim() || item.peer_email;
      const timeLabel = formatTime(item.started_at || item.created_at);
      const showRecording = item.recording_available;
      const recordingLabel = getRecordingLabel(item.recording_status);
      const canViewRecording = item.recording_status === "ready";
      return (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.type}>{getTypeLabel(item)}</Text>
          </View>
          <Text style={styles.email}>{item.peer_email}</Text>
          <Text style={styles.time}>{timeLabel}</Text>
          {showRecording ? (
            <View style={styles.recordingRow}>
              {canViewRecording ? (
                <TouchableOpacity
                  style={styles.recordingButton}
                  onPress={() =>
                    navigation.navigate("CallRecordingDetail", {
                      callId: item.call_id
                    })
                  }
                >
                  <Text style={styles.recordingButtonText}>
                    {recordingLabel}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.recordingStatus}>{recordingLabel}</Text>
              )}
            </View>
          ) : null}
        </View>
      );
    },
    [formatTime, getRecordingLabel, getTypeLabel, navigation]
  );

  // 空状态展示
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
      {/* 通话记录列表 */}
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

// 样式定义
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
  recordingRow: {
    marginTop: 10
  },
  recordingStatus: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "600"
  },
  recordingButton: {
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10
  },
  recordingButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600"
  },
  emptyText: {
    textAlign: "center",
    color: "#6b7280",
    marginTop: 40
  }
});

export default CallLogsScreen;
