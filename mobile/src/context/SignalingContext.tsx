import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Alert,
  PermissionsAndroid,
  Platform
} from "react-native";
import {
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices as webrtcMediaDevices,
  RTCIceServer
} from "react-native-webrtc";
import { Audio } from "expo-av";

import { fetchChatLogs } from "../api/chatLogs";
import { SignalingClient, SignalMessage } from "../api/signaling";
import { fetchWebRTCConfig } from "../api/webrtc";
import { useAuthContext } from "./AuthContext";
import { useLanguage } from "./LanguageContext";

type CallDirection = "incoming" | "outgoing";

type SessionDescriptionPayload = RTCSessionDescriptionInit;

type IceCandidatePayload = RTCIceCandidateInit;

interface CallSession {
  callId: string;
  peerEmail: string;
  direction: CallDirection;
  offer?: SessionDescriptionPayload;
}

type CallStatus = "idle" | "connecting" | "incoming" | "in_call";

export type ChatMessage = {
  id: string;
  from: string;
  to: string;
  body: string;
  sentAt: string;
  direction: "incoming" | "outgoing";
};

const chatMessageKey = (message: ChatMessage) =>
  `${message.from}|${message.to}|${message.sentAt}|${message.body}`;

const normalizeChatMessages = (messages: ChatMessage[]) => {
  const sorted = [...messages].sort((a, b) => {
    const aTime = new Date(a.sentAt).getTime();
    const bTime = new Date(b.sentAt).getTime();
    const aValue = Number.isNaN(aTime) ? 0 : aTime;
    const bValue = Number.isNaN(bTime) ? 0 : bTime;
    return aValue - bValue;
  });
  return sorted;
};

interface SignalingContextValue {
  status: CallStatus;
  session: CallSession | null;
  connectionReady: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (email: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  chatMessages: Record<string, ChatMessage[]>;
  sendChatMessage: (peerEmail: string, text: string) => void;
  loadChatHistory: (peerEmail: string, limit?: number) => Promise<void>;
}

const SignalingContext = createContext<SignalingContextValue | undefined>(
  undefined
);

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" }
];

const isSessionDescriptionPayload = (
  value: unknown
): value is SessionDescriptionPayload => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { sdp?: unknown }).sdp === "string" &&
    typeof (value as { type?: unknown }).type === "string"
  );
};

const isIceCandidatePayload = (
  value: unknown
): value is IceCandidatePayload => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { candidate?: unknown }).candidate === "string"
  );
};

export const SignalingProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const { token, user } = useAuthContext();
  const { t } = useLanguage();
  const [status, setStatus] = useState<CallStatus>("idle");
  const [session, setSession] = useState<CallSession | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>({});

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const pendingTarget = useRef<string | null>(null);
  const pendingLocalCandidates = useRef<IceCandidatePayload[]>([]);
  const pendingRemoteCandidates = useRef<IceCandidatePayload[]>([]);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneRef = useRef<Audio.Sound | null>(null);
  const ringtoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const loadIceServers = async () => {
      if (!token) {
        setIceServers(DEFAULT_ICE_SERVERS);
        return;
      }
      try {
        const config = await fetchWebRTCConfig(token);
        const servers = Array.isArray(config.ice_servers) ? config.ice_servers : [];
        if (!cancelled && servers.length) {
          setIceServers(servers as RTCIceServer[]);
          console.log("[SignalingContext] Using ICE servers from backend", servers);
        } else if (!cancelled) {
          setIceServers(DEFAULT_ICE_SERVERS);
        }
      } catch (error) {
        console.warn("[SignalingContext] Failed to load ICE servers, fallback to defaults", error);
        if (!cancelled) {
          setIceServers(DEFAULT_ICE_SERVERS);
        }
      }
    };
    loadIceServers();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const ensureAudioPermission = useCallback(async () => {
    console.log("[ensureAudioPermission] Platform:", Platform.OS);
    
    if (Platform.OS === "android") {
      try {
        const permissions: string[] = [
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        ];

        if (Platform.Version >= 31) {
          permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        }

        // 部分厂商在仅采集音频时也会检查摄像头权限，提前申请避免崩溃
        permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);

        console.log("[ensureAudioPermission] Requesting permissions:", permissions);
        
        // 直接请求权限，不使用超时（真机上应该正常工作）
        const result = await PermissionsAndroid.requestMultiple(permissions as any);
        console.log("[ensureAudioPermission] Permission result:", result);

        const allGranted = permissions.every(
          (permission) => (result as Record<string, any>)[permission] === PermissionsAndroid.RESULTS.GRANTED
        );
        
        console.log("[ensureAudioPermission] All permissions granted:", allGranted);
        return allGranted;
      } catch (error) {
        console.error("[ensureAudioPermission] Permission request error:", error);
        Alert.alert(
          t("permission_error_title"),
          t("permission_error_body", {
            error: error instanceof Error ? error.message : String(error)
          })
        );
        return false;
      }
    }
    console.log("[ensureAudioPermission] iOS platform, returning true");
    return true;
  }, [t]);

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const stopRingtone = useCallback(async () => {
    if (ringtoneTimeoutRef.current) {
      clearTimeout(ringtoneTimeoutRef.current);
      ringtoneTimeoutRef.current = null;
    }
    if (ringtoneRef.current) {
      try {
        await ringtoneRef.current.stopAsync();
      } catch (error) {
        console.warn("[stopRingtone] stop failed", error);
      }
      try {
        await ringtoneRef.current.unloadAsync();
      } catch (error) {
        console.warn("[stopRingtone] unload failed", error);
      }
      ringtoneRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(async () => {
    await stopRingtone();
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        playsInSilentModeIOS: true
      });
    } catch (error) {
      console.warn("[startRingtone] audio mode setup failed", error);
    }
    try {
      const { sound } = await Audio.Sound.createAsync(
        require("../assets/ring.mp3"),
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      ringtoneRef.current = sound;
      ringtoneTimeoutRef.current = setTimeout(() => {
        void stopRingtone();
      }, 60_000);
    } catch (error) {
      console.warn("[startRingtone] failed to play ringtone", error);
    }
  }, [stopRingtone]);

  const resetPeerResources = useCallback(() => {
    pendingLocalCandidates.current = [];
    pendingRemoteCandidates.current = [];

    if (peerRef.current) {
      (peerRef.current as any).onicecandidate = null;
      (peerRef.current as any).ontrack = null;
      (peerRef.current as any).onconnectionstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
    }

    setLocalStream(null);
    setRemoteStream(null);
  }, [localStream, remoteStream]);

  const resetCallState = useCallback(() => {
    pendingTarget.current = null;
    setSession(null);
    sessionRef.current = null;
    setStatus("idle");
    clearCallTimeout();
    void stopRingtone();
    resetPeerResources();
  }, [clearCallTimeout, resetPeerResources, stopRingtone]);

  const sendMessage = useCallback((message: SignalMessage) => {
    const client = signalingRef.current;
    console.log("[sendMessage] Attempting to send message:", message.type, "to:", message.to);
    
    if (!client) {
      console.warn("[sendMessage] No active signaling client, message dropped", message);
      if (message.type !== "ice.candidate") {
        Alert.alert(t("connection_issue_title"), t("connection_issue_body"));
      }
      return;
    }
    
    try {
      console.log("[sendMessage] Sending message via client.send()...");
      const sent = client.send(message);
      if (!sent) {
        console.debug("[sendMessage] Signaling message queued until connection recovers", message.type);
      } else {
        console.log("[sendMessage] Message sent successfully");
      }
    } catch (error) {
      console.error("[sendMessage] Failed to send signaling message", error);
      if (message.type !== "ice.candidate") {
        Alert.alert(t("connection_issue_title"), t("signal_send_failed_body"));
      }
    }
  }, [t]);

  const enqueueRemoteCandidate = useCallback((candidate: IceCandidatePayload) => {
    const alreadyQueued = pendingRemoteCandidates.current.some(
      (item) =>
        item.candidate === candidate.candidate &&
        item.sdpMid === candidate.sdpMid &&
        item.sdpMLineIndex === candidate.sdpMLineIndex
    );
    if (!alreadyQueued) {
      pendingRemoteCandidates.current.push(candidate);
    }
  }, []);

  const flushPendingLocalCandidates = useCallback(
    (callId: string, peerEmail: string) => {
      if (!pendingLocalCandidates.current.length) {
        return;
      }
      const items = [...pendingLocalCandidates.current];
      pendingLocalCandidates.current = [];
      items.forEach((candidate) =>
        sendMessage({
          type: "ice.candidate",
          call_id: callId,
          to: peerEmail,
          payload: candidate
        })
      );
    },
    [sendMessage]
  );

  const drainRemoteCandidates = useCallback(async () => {
    const pc = peerRef.current;
    if (!pc || !pendingRemoteCandidates.current.length) {
      return;
    }
    const items = [...pendingRemoteCandidates.current];
    pendingRemoteCandidates.current = [];
    for (const candidate of items) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn("Failed to add queued ICE candidate", error);
      }
    }
  }, []);

  const upsertChatMessages = useCallback(
    (peerEmail: string, incoming: ChatMessage[]) => {
      if (!incoming.length) {
        return;
      }
      setChatMessages((current) => {
        const existing = current[peerEmail] ?? [];
        const existingKeys = new Set(existing.map(chatMessageKey));
        const merged = [...existing];
        incoming.forEach((message) => {
          const key = chatMessageKey(message);
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            merged.push(message);
          }
        });
        return {
          ...current,
          [peerEmail]: normalizeChatMessages(merged)
        };
      });
    },
    []
  );

  const appendChatMessage = useCallback(
    (peerEmail: string, message: ChatMessage) => {
      upsertChatMessages(peerEmail, [message]);
    },
    [upsertChatMessages]
  );

  const loadChatHistory = useCallback(
    async (peerEmail: string, limit = 50) => {
      if (!token) {
        Alert.alert(t("login_required_title"), t("login_required_body"));
        return;
      }
      const target = peerEmail.trim();
      if (!target) {
        return;
      }
      try {
        const logs = await fetchChatLogs(token, target, limit);
        const history = logs.map((log) => ({
          id: `server-${log.id}`,
          from: log.sender_email,
          to: log.receiver_email,
          body: log.body,
          sentAt: log.sent_at,
          direction: log.direction
        }));
        upsertChatMessages(target, history);
      } catch (error) {
        console.error("loadChatHistory error", error);
        Alert.alert(t("error_title"), t("chat_load_failed"));
      }
    },
    [t, token, upsertChatMessages]
  );

  const sendChatMessage = useCallback(
    (peerEmail: string, text: string) => {
      const content = text.trim();
      if (!content) {
        return;
      }
      if (!user?.email) {
        Alert.alert(t("login_required_title"), t("login_required_body"));
        return;
      }
      const sentAt = new Date().toISOString();
      const message: ChatMessage = {
        id: `${user.email}-${sentAt}`,
        from: user.email,
        to: peerEmail,
        body: content,
        sentAt,
        direction: "outgoing"
      };
      appendChatMessage(peerEmail, message);
      sendMessage({
        type: "chat.message",
        to: peerEmail,
        payload: {
          text: content,
          sent_at: sentAt
        }
      });
    },
    [appendChatMessage, sendMessage, t, user?.email]
  );

  const scheduleCallTimeout = useCallback(
    (callId: string, peerEmail: string) => {
      if (!callId || !peerEmail) {
        return;
      }
      clearCallTimeout();
      callTimeoutRef.current = setTimeout(() => {
        sendMessage({
          type: "call.end",
          call_id: callId,
          to: peerEmail,
          payload: { reason: "timeout" }
        });
        Alert.alert(t("call_timeout_title"), t("call_timeout_body"));
        resetCallState();
      }, 60_000);
    },
    [clearCallTimeout, resetCallState, sendMessage, t]
  );

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: "max-bundle",
      iceTransportPolicy: "all"
    } as any);

    (pc as any).onicecandidate = (event: any) => {
      if (!event.candidate) {
        return;
      }
      const candidateInit: IceCandidatePayload = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? undefined,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined
      };
      const current = sessionRef.current;
      if (current?.callId) {
        sendMessage({
          type: "ice.candidate",
          call_id: current.callId,
          to: current.peerEmail,
          payload: candidateInit as any
        });
      } else {
        pendingLocalCandidates.current.push(candidateInit);
      }
    };

    (pc as any).ontrack = (event: any) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStream(stream);
      }
    };

    (pc as any).onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed"
      ) {
        resetCallState();
      }
    };

    peerRef.current = pc;
    return pc;
  }, [iceServers, resetCallState, sendMessage]);

  useEffect(() => {
    if (!token) {
      console.log("[SignalingContext] No token available, disconnecting");
      signalingRef.current?.disconnect();
      signalingRef.current = null;
      setConnectionReady(false);
      setChatMessages({});
      resetCallState();
      return;
    }

    console.log("[SignalingContext] Token available, initializing signaling client", {
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20) + "..."
    });
    const client = new SignalingClient(token);
    signalingRef.current = client;
    client.connect();

    const handleOpen = () => {
      console.log("[SignalingContext] Signaling connection opened successfully!");
      setConnectionReady(true);
    };
    const handleClose = () => {
      console.warn("[SignalingContext] Signaling connection closed");
      setConnectionReady(false);
      resetCallState();
    };

    const handleMessage = async (message: SignalMessage) => {
      console.log("[SignalingContext] Received message:", message.type, "from:", message.from);
      switch (message.type) {
        case "call.invite.ack":
          console.log("[SignalingContext] Received call.invite.ack, callId:", message.call_id, "pendingTarget:", pendingTarget.current);
          if (pendingTarget.current) {
            const newSession: CallSession = {
              callId: message.call_id ?? "",
              peerEmail: pendingTarget.current,
              direction: "outgoing"
            };
            console.log("[SignalingContext] Creating new session:", newSession);
            sessionRef.current = newSession;
            setSession(newSession);
            setStatus("connecting");
            if (newSession.callId) {
              console.log("[SignalingContext] Flushing pending local candidates");
              flushPendingLocalCandidates(
                newSession.callId,
                newSession.peerEmail
              );
              scheduleCallTimeout(newSession.callId, newSession.peerEmail);
            }
            pendingTarget.current = null;
          } else {
            console.warn("[SignalingContext] Received call.invite.ack but no pending target");
          }
          break;
        case "call.invite":
          if (!message.from || !isSessionDescriptionPayload(message.payload)) {
            Alert.alert(t("call_error_title"), t("call_error_invalid_invite"));
            break;
          }
          setSession({
            callId: message.call_id ?? "",
            peerEmail: message.from,
            direction: "incoming",
            offer: message.payload as SessionDescriptionPayload
          });
          setStatus("incoming");
          void startRingtone();
          break;
        case "call.accept":
          clearCallTimeout();
          void stopRingtone();
          if (isSessionDescriptionPayload(message.payload)) {
            const pc = peerRef.current;
            if (pc && message.payload.sdp) {
              try {
                await pc.setRemoteDescription(
                  new RTCSessionDescription(message.payload as any)
                );
                await drainRemoteCandidates();
              } catch (error) {
                console.warn("Failed to apply remote answer", error);
              }
            }
          }
          setStatus("in_call");
          setSession((current) =>
            current
              ? {
                  ...current,
                  callId: message.call_id ?? current.callId
                }
              : current
          );
          if (sessionRef.current && message.call_id) {
            const current = {
              ...sessionRef.current,
              callId: message.call_id
            };
            sessionRef.current = current;
            flushPendingLocalCandidates(current.callId, current.peerEmail);
          }
          break;
        case "call.reject":
          clearCallTimeout();
          void stopRingtone();
          Alert.alert(
            t("call_rejected_title"),
            t("call_rejected_body", { name: message.from ?? "" })
          );
          resetCallState();
          break;
        case "call.end":
          clearCallTimeout();
          void stopRingtone();
          if (
            message.payload &&
            typeof message.payload === "object" &&
            "reason" in message.payload &&
            String((message.payload as any).reason) === "timeout" &&
            statusRef.current !== "in_call"
          ) {
            Alert.alert(t("missed_call_title"), t("missed_call_body"));
          } else {
            Alert.alert(
              t("call_ended_title"),
              t("call_ended_body", { name: message.from ?? "" })
            );
          }
          resetCallState();
          break;
        case "chat.message": {
          if (!message.from || !message.payload || typeof message.payload !== "object") {
            break;
          }
          const payload = message.payload as { text?: string; sent_at?: string };
          if (!payload.text) {
            break;
          }
          const sentAt = payload.sent_at || new Date().toISOString();
          const incoming: ChatMessage = {
            id: `${message.from}-${sentAt}`,
            from: message.from,
            to: message.to,
            body: payload.text,
            sentAt,
            direction: "incoming"
          };
          appendChatMessage(message.from, incoming);
          break;
        }
        case "ice.candidate":
          if (isIceCandidatePayload(message.payload)) {
            const pc = peerRef.current;
            if (pc) {
              const hasRemoteDescription =
                pc.remoteDescription !== null &&
                typeof pc.remoteDescription?.type === "string";
              if (hasRemoteDescription) {
                try {
                  await pc.addIceCandidate(
                    new RTCIceCandidate(message.payload)
                  );
                } catch (error) {
                  console.warn("Failed to add ICE candidate", error);
                }
              } else {
                enqueueRemoteCandidate(message.payload);
              }
            } else {
              enqueueRemoteCandidate(message.payload);
            }
          }
          break;
        case "call.error":
          Alert.alert(t("call_error_title"), t("call_error_generic"));
          resetCallState();
          break;
        default:
          break;
      }
    };

    client.on("open", handleOpen);
    client.on("close", handleClose);
    client.on("message", handleMessage);
    client.on("error", (err) => console.warn("signaling error", err));

    return () => {
      client.off("open", handleOpen);
      client.off("close", handleClose);
      client.off("message", handleMessage);
      client.disconnect();
      signalingRef.current = null;
    };
  }, [
    appendChatMessage,
    clearCallTimeout,
    drainRemoteCandidates,
    enqueueRemoteCandidate,
    flushPendingLocalCandidates,
    resetCallState,
    scheduleCallTimeout,
    startRingtone,
    stopRingtone,
    t,
    token
  ]);

  const startCall = useCallback(
    async (email: string) => {
      console.log("[startCall] Starting call to:", email, "Current status:", status);
      
      if (!user) {
        console.warn("[startCall] No user logged in");
        Alert.alert(t("login_required_title"), t("login_required_body"));
        return;
      }
      
      if (status !== "idle") {
        console.warn("[startCall] Call already in progress. Current status:", status);
        Alert.alert(t("call_in_progress_title"), t("call_in_progress_body"));
        return;
      }

      try {
        console.log("[startCall] Requesting audio permissions...");
        const hasPermission = await ensureAudioPermission();
        if (!hasPermission) {
          console.warn("[startCall] Audio permission denied");
          Alert.alert(t("mic_permission_title"), t("mic_permission_body"));
          return;
        }
        console.log("[startCall] Audio permission granted");

        console.log("[startCall] Resetting peer resources...");
        resetPeerResources();
        
        console.log("[startCall] Requesting media stream...");
        console.log("[startCall] webrtcMediaDevices:", webrtcMediaDevices ? "available" : "null");
        
        if (!webrtcMediaDevices) {
          throw new Error("WebRTC mediaDevices not available. Please use 'expo run:android' to build a native app.");
        }
        
        console.log("[startCall] Requesting getUserMedia with audio only...");
        const stream = await webrtcMediaDevices.getUserMedia({
          audio: true,
          video: false
        });
        console.log("[startCall] Media stream obtained:", stream.getTracks().length, "tracks");
        stream.getTracks().forEach((track) => {
          console.log("[startCall] Track obtained - Kind:", track.kind, "Enabled:", track.enabled);
        });
        setLocalStream(stream);

        console.log("[startCall] Creating peer connection...");
        const pc = createPeerConnection();
        stream.getTracks().forEach((track) => {
          console.log("[startCall] Adding track:", track.kind);
          pc.addTrack(track, stream);
        });

        console.log("[startCall] Creating offer...");
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        console.log("[startCall] Offer created, SDP length:", offer.sdp?.length);
        
        console.log("[startCall] Setting local description...");
        await pc.setLocalDescription(offer);
        console.log("[startCall] Local description set");

        pendingTarget.current = email;
        setStatus("connecting");
        console.log("[startCall] Status changed to 'connecting'");
        
        console.log("[startCall] Sending call.invite message...");
        sendMessage({
          type: "call.invite",
          to: email,
          payload: {
            sdp: offer.sdp,
            type: offer.type
          }
        });
        console.log("[startCall] call.invite message sent");
      } catch (error) {
        console.error("[startCall] Error occurred:", error);
        console.error("[startCall] Error name:", (error as Error)?.name);
        console.error("[startCall] Error message:", (error as Error)?.message);
        const errorMsg = error instanceof Error ? error.message : String(error);
        Alert.alert(
          t("call_start_failed_title"),
          t("call_start_failed_body", { error: errorMsg })
        );
        resetPeerResources();
        setStatus("idle");
      }
    },
    [
      createPeerConnection,
      ensureAudioPermission,
      resetPeerResources,
      sendMessage,
      status,
      t,
      user
    ]
  );

  const acceptCall = useCallback(async () => {
    if (!session || session.direction !== "incoming" || !session.offer) {
      return;
    }

    void stopRingtone();

    const hasPermission = await ensureAudioPermission();
    if (!hasPermission) {
      Alert.alert(t("mic_permission_title"), t("mic_permission_body"));
      return;
    }

    try {
      console.log("[acceptCall] Requesting media stream...");
      console.log("[acceptCall] webrtcMediaDevices:", webrtcMediaDevices ? "available" : "null");
      
      if (!webrtcMediaDevices) {
        throw new Error("WebRTC mediaDevices not available. Please use 'expo run:android' to build a native app.");
      }
      
      console.log("[acceptCall] Requesting getUserMedia with audio only...");
      const stream = await webrtcMediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      console.log("[acceptCall] Media stream obtained:", stream.getTracks().length, "tracks");
      stream.getTracks().forEach((track) => {
        console.log("[acceptCall] Track obtained - Kind:", track.kind, "Enabled:", track.enabled);
      });
      setLocalStream(stream);

      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(session.offer as any));
      } catch (error) {
        console.warn("setRemoteDescription failed", error);
        Alert.alert(t("call_error_title"), t("call_error_invalid_invite"));
        resetCallState();
        return;
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await drainRemoteCandidates();

      sendMessage({
        type: "call.accept",
        call_id: session.callId,
        to: session.peerEmail,
        payload: {
          sdp: answer.sdp,
          type: answer.type
        }
      });

      setStatus("in_call");
    } catch (error) {
      console.error("acceptCall error", error);
      Alert.alert(t("call_accept_failed_title"), t("call_accept_failed_body"));
      resetCallState();
    }
  }, [
    createPeerConnection,
    drainRemoteCandidates,
    ensureAudioPermission,
    resetCallState,
    sendMessage,
    session,
    stopRingtone,
    t
  ]);

  const rejectCall = useCallback(() => {
    if (!session) {
      return;
    }
    void stopRingtone();
    sendMessage({
      type: "call.reject",
      call_id: session.callId,
      to: session.peerEmail
    });
    resetCallState();
  }, [resetCallState, sendMessage, session, stopRingtone]);

  const endCall = useCallback(() => {
    if (!session) {
      return;
    }
    clearCallTimeout();
    void stopRingtone();
    sendMessage({
      type: "call.end",
      call_id: session.callId,
      to: session.peerEmail
    });
    resetCallState();
  }, [clearCallTimeout, resetCallState, sendMessage, session, stopRingtone]);

  const value = useMemo<SignalingContextValue>(
    () => ({
      status,
      session,
      connectionReady,
      localStream,
      remoteStream,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      chatMessages,
      sendChatMessage,
      loadChatHistory
    }),
    [
      status,
      session,
      connectionReady,
      localStream,
      remoteStream,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      chatMessages,
      sendChatMessage,
      loadChatHistory
    ]
  );

  return (
    <SignalingContext.Provider value={value}>
      {children}
    </SignalingContext.Provider>
  );
};

export const useSignaling = () => {
  const ctx = useContext(SignalingContext);
  if (!ctx) {
    throw new Error("useSignaling must be used within SignalingProvider");
  }
  return ctx;
};
