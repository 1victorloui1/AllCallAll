// 通话录音详情页：展示转写文本、摘要与翻译
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { fetchRecording, CallRecordingDetail } from "../api/callRecordings";
import { useAuthContext } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "CallRecordingDetail">;

const CallRecordingDetailScreen: React.FC<Props> = ({ route }) => {
  const { callId } = route.params;
  const { token } = useAuthContext();
  const { t } = useLanguage();

  const [detail, setDetail] = useState<CallRecordingDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!token) {
      Alert.alert(t("login_required_title"), t("login_required_body"));
      return;
    }
    try {
      setLoading(true);
      const data = await fetchRecording(token, callId);
      setDetail(data);
    } catch (error) {
      console.error(error);
      Alert.alert(t("error_title"), t("recording_detail_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [callId, t, token]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const transcript = useMemo(() => detail?.transcript ?? [], [detail]);

  if (loading && !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{t("recording_detail_empty")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("recording_detail_title")}</Text>
      <Text style={styles.subTitle}>
        {t("recording_detail_status", { status: detail.status })}
      </Text>

      {detail.error_message ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("recording_detail_error")}</Text>
          <Text style={styles.errorText}>{detail.error_message}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("recording_detail_summary")}</Text>
        <Text style={styles.bodyText}>
          {detail.summary_text || t("recording_detail_pending")}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t("recording_detail_translated_summary")}
        </Text>
        <Text style={styles.bodyText}>
          {detail.translated_summary || t("recording_detail_pending")}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("recording_detail_transcript")}</Text>
        {transcript.length ? (
          transcript.map((seg, index) => (
            <View key={`${seg.speaker}-${index}`} style={styles.segment}>
              <Text style={styles.segmentMeta}>
                {t("recording_detail_speaker", { speaker: seg.speaker })} ·{" "}
                {Math.max(seg.start_ms, 0)}-{Math.max(seg.end_ms, 0)}ms
              </Text>
              <Text style={styles.bodyText}>{seg.text}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.bodyText}>{t("recording_detail_pending")}</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t("recording_detail_translated_transcript")}
        </Text>
        <Text style={styles.bodyText}>
          {detail.translated_transcript || t("recording_detail_pending")}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6"
  },
  content: {
    padding: 20,
    paddingBottom: 40
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6
  },
  subTitle: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 16
  },
  section: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8
  },
  bodyText: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 20
  },
  segment: {
    marginBottom: 10
  },
  segmentMeta: {
    fontSize: 11,
    color: "#9ca3af",
    marginBottom: 4
  },
  errorText: {
    fontSize: 13,
    color: "#dc2626"
  },
  empty: {
    fontSize: 14,
    color: "#6b7280"
  }
});

export default CallRecordingDetailScreen;
