// 通话悬浮层：展示通话状态并提供接听/挂断操作
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { RTCView } from "react-native-webrtc";

import { useSignaling } from "../context/SignalingContext";
import { useLanguage } from "../context/LanguageContext";

// 通话浮层组件
const CallOverlay: React.FC = () => {
  const {
    status,
    session,
    acceptCall,
    rejectCall,
    endCall,
    isRecording,
    startRecording,
    localStream,
    remoteStream
  } = useSignaling();
  const { t } = useLanguage();

  // 空闲或无会话时不显示
  if (status === "idle" || !session) {
    return null;
  }

  // 判断是否是来电
  const isIncoming = session.direction === "incoming";

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* 挂载音频流（用隐藏 RTCView 保持音频输出） */}
      <View style={styles.audioAttachments} pointerEvents="none">
        {localStream ? (
          <RTCView streamURL={localStream.toURL()} style={styles.hiddenVideo} />
        ) : null}
        {remoteStream ? (
          <RTCView streamURL={remoteStream.toURL()} style={styles.hiddenVideo} />
        ) : null}
      </View>
      {/* 状态卡片 */}
      <View style={styles.card}>
        <Text style={styles.title}>
          {status === "connecting"
            ? t("call_status_calling", { email: session.peerEmail })
            : status === "incoming"
            ? t("call_status_incoming", { email: session.peerEmail })
            : t("call_status_in_call", { email: session.peerEmail })}
        </Text>
        <Text style={styles.subtitle}>
          {t("call_status_label", {
            status:
              status === "connecting"
                ? t("call_status_connecting")
                : status === "incoming"
                ? t("call_status_incoming_short")
                : t("call_status_in_call_short")
          })}
        </Text>
        {status === "in_call" ? (
          <View style={styles.recordRow}>
            {isRecording ? (
              <Text style={styles.recordingBadge}>
                {t("recording_in_progress")}
              </Text>
            ) : (
              <TouchableOpacity
                style={styles.recordButton}
                onPress={startRecording}
              >
                <Text style={styles.recordButtonText}>
                  {t("record_call_button")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
        {/* 操作按钮 */}
        <View style={styles.actions}>
          {isIncoming && status === "incoming" ? (
            <>
              <TouchableOpacity
                style={[styles.button, styles.accept]}
                onPress={acceptCall}
              >
                <Text style={styles.buttonText}>{t("call_accept")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.reject]}
                onPress={rejectCall}
              >
                <Text style={styles.buttonText}>{t("call_reject")}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.reject]}
              onPress={endCall}
            >
              <Text style={styles.buttonText}>{t("call_end")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 20,
    paddingHorizontal: 20
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8
  },
  subtitle: {
    color: "#e5e7eb",
    fontSize: 14,
    marginBottom: 16
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end"
  },
  recordRow: {
    marginBottom: 12,
    alignItems: "flex-start"
  },
  recordButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#ef4444",
    borderRadius: 12
  },
  recordButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13
  },
  recordingBadge: {
    color: "#f87171",
    fontWeight: "700",
    fontSize: 13
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
  },
  accept: {
    backgroundColor: "#22c55e",
    marginRight: 12
  },
  reject: {
    backgroundColor: "#dc2626"
  },
  hiddenVideo: {
    width: 1,
    height: 1,
    opacity: 0
  },
  audioAttachments: {
    position: "absolute",
    width: 1,
    height: 1,
    top: 0,
    left: 0
  }
});

export default CallOverlay;
