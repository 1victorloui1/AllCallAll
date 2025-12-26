import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { RTCView } from "react-native-webrtc";

import { useSignaling } from "../context/SignalingContext";
import { useLanguage } from "../context/LanguageContext";

const CallOverlay: React.FC = () => {
  const {
    status,
    session,
    acceptCall,
    rejectCall,
    endCall,
    localStream,
    remoteStream
  } = useSignaling();
  const { t } = useLanguage();

  if (status === "idle" || !session) {
    return null;
  }

  const isIncoming = session.direction === "incoming";

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.audioAttachments} pointerEvents="none">
        {localStream ? (
          <RTCView streamURL={localStream.toURL()} style={styles.hiddenVideo} />
        ) : null}
        {remoteStream ? (
          <RTCView streamURL={remoteStream.toURL()} style={styles.hiddenVideo} />
        ) : null}
      </View>
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
