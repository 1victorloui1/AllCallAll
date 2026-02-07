// 信令与通话核心：管理 WebSocket、WebRTC、铃声与聊天状态
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
  mediaDevices as webrtcMediaDevices
} from "react-native-webrtc";
import { Audio } from "expo-av";

import { fetchChatLogs } from "../api/chatLogs";
import { startRecording as startRecordingApi, uploadRecording as uploadRecordingApi } from "../api/callRecordings";
import { SignalingClient, SignalMessage } from "../api/signaling";
import { fetchWebRTCConfig } from "../api/webrtc";
import { useAuthContext } from "./AuthContext";
import { useLanguage } from "./LanguageContext";

// 通话方向
type CallDirection = "incoming" | "outgoing";

// SDP 描述
type SessionDescriptionPayload = RTCSessionDescriptionInit;

// ICE 候选
type IceCandidatePayload = RTCIceCandidateInit;

// 当前通话会话
interface CallSession {
  callId: string;
  peerEmail: string;
  direction: CallDirection;
  offer?: SessionDescriptionPayload;
}

// 通话状态
type CallStatus = "idle" | "connecting" | "incoming" | "in_call";

// 聊天消息结构（本地展示使用）
export type ChatMessage = {
  id: string;
  from: string;
  to: string;
  body: string;
  sentAt: string;
  direction: "incoming" | "outgoing";
};

// ICE 服务器配置结构（react-native-webrtc 类型缺失时的兼容定义）
type RTCIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: string;
};

// 聊天消息去重键
const chatMessageKey = (message: ChatMessage) =>
  `${message.from}|${message.to}|${message.sentAt}|${message.body}`;

// 聊天消息按时间排序（升序）
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

// 对外暴露的信令上下文能力
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
  isRecording: boolean;
  startRecording: () => Promise<void>;
  chatMessages: Record<string, ChatMessage[]>;
  sendChatMessage: (peerEmail: string, text: string) => void;
  loadChatHistory: (peerEmail: string, limit?: number) => Promise<void>;
}

// 创建信令上下文
const SignalingContext = createContext<SignalingContextValue | undefined>(
  undefined
);

// 默认 STUN 列表（后端不可用时的降级）
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" }
];

// 校验 SDP 结构
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

// 校验 ICE 结构
const isIceCandidatePayload = (
  value: unknown
): value is IceCandidatePayload => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { candidate?: unknown }).candidate === "string"
  );
};

// 核心：管理信令连接、WebRTC、铃声、聊天与状态
export const SignalingProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const { token, user } = useAuthContext();
  const { t, language } = useLanguage();
  // 通话与连接状态
  const [status, setStatus] = useState<CallStatus>("idle");
  const [session, setSession] = useState<CallSession | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const [isRecording, setIsRecording] = useState(false);
  // 聊天消息缓存（按对方邮箱归档）
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>({});

  // 运行中的连接/会话引用，避免闭包读到旧状态
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
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingCallIdRef = useRef<string | null>(null);
  const recordingOwnerRef = useRef(false);

  // 同步会话引用，避免闭包读取旧值
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // 同步状态引用，便于在回调里读取
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // 登录后从后端拉取 ICE/TURN 配置，失败则回退默认 STUN
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

  // 申请通话所需权限（音频/蓝牙/部分机型摄像头）
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

  // 清理拨出超时计时器
  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  // 停止并卸载铃声
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

  // 播放铃声（循环，最多 60 秒）
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

  // 录音文件 mime 类型推断
  const getRecordingMimeType = useCallback((uri: string) => {
    const ext = uri.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "wav":
        return "audio/wav";
      case "mp4":
        return "audio/mp4";
      case "m4a":
        return "audio/m4a";
      case "3gp":
        return "audio/3gpp";
      default:
        return "audio/m4a";
    }
  }, []);

  // 开始本地录音
  const startLocalRecording = useCallback(async () => {
    if (recordingRef.current) {
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        staysActiveInBackground: false,
        playsInSilentModeIOS: true
      });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (error) {
      console.error("startLocalRecording failed", error);
      Alert.alert(t("error_title"), t("recording_start_failed"));
    }
  }, [t]);

  // 停止本地录音并返回文件路径
  const stopLocalRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) {
      return null;
    }
    recordingRef.current = null;
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
    } catch (error) {
      console.warn("stopLocalRecording failed", error);
    }
    const uri = recording.getURI();
    return uri ?? null;
  }, []);

  // 结束录音并上传音频
  const finalizeRecording = useCallback(async () => {
    if (!recordingRef.current) {
      return;
    }
    const callId = recordingCallIdRef.current ?? sessionRef.current?.callId ?? "";
    const uri = await stopLocalRecording();
    recordingOwnerRef.current = false;
    recordingCallIdRef.current = null;
    if (!uri || !token || !callId) {
      return;
    }
    const mimeType = getRecordingMimeType(uri);
    try {
      await uploadRecordingApi(token, callId, uri, mimeType);
    } catch (error) {
      console.error("uploadRecording failed", error);
      Alert.alert(t("error_title"), t("recording_upload_failed"));
    }
  }, [getRecordingMimeType, stopLocalRecording, t, token]);

  // 释放 WebRTC 资源与媒体流
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

  // 重置通话状态（结束/失败后的统一收尾）
  const resetCallState = useCallback(() => {
    pendingTarget.current = null;
    void finalizeRecording();
    recordingCallIdRef.current = null;
    recordingOwnerRef.current = false;
    setIsRecording(false);
    setSession(null);
    sessionRef.current = null;
    setStatus("idle");
    clearCallTimeout();
    void stopRingtone();
    resetPeerResources();
  }, [clearCallTimeout, finalizeRecording, resetPeerResources, stopRingtone]);

  // 统一发送信令消息，自动处理断线提示
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

  // 缓存远端 ICE（等远端描述设置后再补）
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

  // 批量补发本地 ICE
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

  // 批量补加远端 ICE
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

  // 合并聊天记录并去重排序
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

  // 追加单条聊天记录
  const appendChatMessage = useCallback(
    (peerEmail: string, message: ChatMessage) => {
      upsertChatMessages(peerEmail, [message]);
    },
    [upsertChatMessages]
  );

  // 从后端拉取历史聊天记录并合并
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

  // 发送聊天消息（先本地回显，再走信令）
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

  // 开始录音：发起录音会话并通知对端
  const startRecording = useCallback(async () => {
    if (!token || !user) {
      Alert.alert(t("login_required_title"), t("login_required_body"));
      return;
    }
    if (statusRef.current !== "in_call") {
      Alert.alert(t("call_error_title"), t("call_error_generic"));
      return;
    }
    if (isRecording) {
      return;
    }
    const currentSession = sessionRef.current;
    if (!currentSession || !currentSession.callId) {
      Alert.alert(t("call_error_title"), t("call_error_generic"));
      return;
    }
    try {
      await startRecordingApi(token, currentSession.callId, language);
      await startLocalRecording();
      if (!recordingRef.current) {
        return;
      }
      recordingOwnerRef.current = true;
      recordingCallIdRef.current = currentSession.callId;
    } catch (error) {
      console.error("startRecording failed", error);
      Alert.alert(t("error_title"), t("recording_start_failed"));
    }
  }, [isRecording, language, startLocalRecording, t, token, user]);

  // 拨出超时：60 秒无人接听则自动结束
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

  // 创建 PeerConnection 并绑定 ICE/轨道/状态监听
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

  // 建立 WebSocket 信令连接，并处理各类信令消息
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

    // 核心信令分发：call/ice/chat
    const handleMessage = async (message: SignalMessage) => {
      console.log("[SignalingContext] Received message:", message.type, "from:", message.from);
      switch (message.type) {
        case "call.invite.ack":
          console.log("[SignalingContext] Received call.invite.ack, callId:", message.call_id, "pendingTarget:", pendingTarget.current);
          // 只有在自己发起呼叫后，pendingTarget 才会有值
          // 这里确认后端已分配 call_id，然后创建本地会话
          if (pendingTarget.current) {
            const newSession: CallSession = {
              callId: message.call_id ?? "",
              peerEmail: pendingTarget.current,
              direction: "outgoing"
            };
            console.log("[SignalingContext] Creating new session:", newSession);
            sessionRef.current = newSession;
            setSession(newSession);
            // 发起端状态进入“呼叫中”
            setStatus("connecting");
            if (newSession.callId) {
              console.log("[SignalingContext] Flushing pending local candidates");
              // 把之前缓存的本地 ICE 候选补发给对端
              flushPendingLocalCandidates(
                newSession.callId,
                newSession.peerEmail
              );
              // 启动 60 秒无人接听的超时计时器
              scheduleCallTimeout(newSession.callId, newSession.peerEmail);
            }
            // ack 处理完后清空待呼叫目标
            pendingTarget.current = null;
          } else {
            console.warn("[SignalingContext] Received call.invite.ack but no pending target");
          }
          break;
        case "call.invite":
          // 收到来电：必须有 from 且 payload 是合法 SDP
          if (!message.from || !isSessionDescriptionPayload(message.payload)) {
            Alert.alert(t("call_error_title"), t("call_error_invalid_invite"));
            break;
          }
          // 保存来电会话信息，并切换到 incoming 状态
          setSession({
            callId: message.call_id ?? "",
            peerEmail: message.from,
            direction: "incoming",
            offer: message.payload as SessionDescriptionPayload
          });
          setStatus("incoming");
          // 播放来电铃声
          void startRingtone();
          break;
        case "call.accept":
          // 对方接听：停止超时计时器与铃声
          clearCallTimeout();
          void stopRingtone();
          if (isSessionDescriptionPayload(message.payload)) {
            const pc = peerRef.current;
            if (pc && message.payload.sdp) {
              try {
                // 设置远端 answer，完成 SDP 协商
                await pc.setRemoteDescription(
                  new RTCSessionDescription(message.payload as any)
                );
                // 把缓存的远端 ICE 候选补加到 PeerConnection
                await drainRemoteCandidates();
              } catch (error) {
                console.warn("Failed to apply remote answer", error);
              }
            }
          }
          // 切换为通话中状态
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
            // 同步 call_id 并补发本地 ICE 候选
            const current = {
              ...sessionRef.current,
              callId: message.call_id
            };
            sessionRef.current = current;
            flushPendingLocalCandidates(current.callId, current.peerEmail);
          }
          break;
        case "call.reject":
          // 对方拒绝：停止超时与铃声，提示用户
          clearCallTimeout();
          void stopRingtone();
          Alert.alert(
            t("call_rejected_title"),
            t("call_rejected_body", { name: message.from ?? "" })
          );
          // 清理本地会话与媒体
          resetCallState();
          break;
        case "call.end":
          // 对方挂断或超时：清理状态并提示
          clearCallTimeout();
          void stopRingtone();
          void finalizeRecording();
          if (
            message.payload &&
            typeof message.payload === "object" &&
            "reason" in message.payload &&
            String((message.payload as any).reason) === "timeout" &&
            statusRef.current !== "in_call"
          ) {
            // 如果是超时结束且当前未进入通话中，提示未接来电
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
          // 收到聊天消息：追加到聊天列表
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
          // ICE 候选交换：用于打通 P2P 或 TURN 连接
          if (isIceCandidatePayload(message.payload)) {
            const pc = peerRef.current;
            if (pc) {
              const hasRemoteDescription =
                pc.remoteDescription !== null &&
                typeof pc.remoteDescription?.type === "string";
              if (hasRemoteDescription) {
                try {
                  // 已设置远端 SDP，直接添加候选
                  await pc.addIceCandidate(
                    new RTCIceCandidate(message.payload)
                  );
                } catch (error) {
                  console.warn("Failed to add ICE candidate", error);
                }
              } else {
                // 未设置远端 SDP，先缓存候选
                enqueueRemoteCandidate(message.payload);
              }
            } else {
              // PeerConnection 尚未创建，也先缓存
              enqueueRemoteCandidate(message.payload);
            }
          }
          break;
        case "call.error":
          // 发生通话错误时提示并清理
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
    finalizeRecording,
    drainRemoteCandidates,
    enqueueRemoteCandidate,
    flushPendingLocalCandidates,
    resetCallState,
    scheduleCallTimeout,
    startLocalRecording,
    startRingtone,
    stopRingtone,
    t,
    token
  ]);

  // 发起通话：获取本地流、创建 offer、发送 call.invite
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
        const hasPermission = await ensureAudioPermission();//申请麦克风权限
        if (!hasPermission) {
          console.warn("[startCall] Audio permission denied");
          Alert.alert(t("mic_permission_title"), t("mic_permission_body"));
          return;
        }
        console.log("[startCall] Audio permission granted");

        console.log("[startCall] Resetting peer resources...");
        resetPeerResources();//清理旧资源防止上一次对话残留
        
        console.log("[startCall] Requesting media stream...");
        console.log("[startCall] webrtcMediaDevices:", webrtcMediaDevices ? "available" : "null");
        
        if (!webrtcMediaDevices) {
          throw new Error("WebRTC mediaDevices not available. Please use 'expo run:android' to build a native app.");
        }
        
        console.log("[startCall] Requesting getUserMedia with audio only...");
        const stream = await webrtcMediaDevices.getUserMedia({
          audio: true,
          video: false
        });//获取本地音频流
        console.log("[startCall] Media stream obtained:", stream.getTracks().length, "tracks");
        stream.getTracks().forEach((track) => {
          console.log("[startCall] Track obtained - Kind:", track.kind, "Enabled:", track.enabled);
        });
        setLocalStream(stream);

        console.log("[startCall] Creating peer connection...");
        const pc = createPeerConnection();//创建 WebRTC 连接 pc，并把本地音频 track 加进去
        stream.getTracks().forEach((track) => {
          console.log("[startCall] Adding track:", track.kind);
          pc.addTrack(track, stream);//我这边要把这条音频发送给对方
        });

        console.log("[startCall] Creating offer...");
        const offer = await pc.createOffer({//创建 offer（通话邀请的“提案”）
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        console.log("[startCall] Offer created, SDP length:", offer.sdp?.length);
        
        console.log("[startCall] Setting local description...");
        await pc.setLocalDescription(offer);//告诉 pc：“这是我准备发给对方的提案”，pc 会基于它开始 ICE candidate 收集
        console.log("[startCall] Local description set");

        pendingTarget.current = email;//更新状态 + 记录目标 + 发送 call.invite 给对方
        setStatus("connecting");//UI界面进入通话逻辑
        console.log("[startCall] Status changed to 'connecting'");
        
        console.log("[startCall] Sending call.invite message...");
        sendMessage({
          type: "call.invite",
          to: email,
          payload: {
            sdp: offer.sdp,
            type: offer.type
          }
        });//走websocket发送的信令消息
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

  // 接听通话：设置远端 SDP、回传 answer
  const acceptCall = useCallback(async () => {
    // 只有在来电状态且有 offer 时才允许接听
    if (!session || session.direction !== "incoming" || !session.offer) {
      return;
    }

    // 停止来电铃声
    void stopRingtone();

    // 再次确认麦克风/蓝牙权限（部分机型需要）
    const hasPermission = await ensureAudioPermission();
    if (!hasPermission) {
      Alert.alert(t("mic_permission_title"), t("mic_permission_body"));
      return;
    }

    try {
      // 获取本地音频流
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

      // 创建 PeerConnection 并绑定本地轨道
      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 设置远端 offer（来自对方的 call.invite）
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(session.offer as any));
      } catch (error) {
        console.warn("setRemoteDescription failed", error);
        Alert.alert(t("call_error_title"), t("call_error_invalid_invite"));
        resetCallState();
        return;
      }

      // 生成 answer 并设置为本地描述
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // 补加此前缓存的远端 ICE 候选
      await drainRemoteCandidates();

      // 通过信令发送 call.accept（携带 answer）
      sendMessage({
        type: "call.accept",
        call_id: session.callId,
        to: session.peerEmail,
        payload: {
          sdp: answer.sdp,
          type: answer.type
        }
      });

      // 切换为通话中状态
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

  // 拒绝通话
  const rejectCall = useCallback(() => {
    // 没有会话时不处理
    if (!session) {
      return;
    }
    // 停止铃声并发送拒绝信令
    void stopRingtone();
    sendMessage({
      type: "call.reject",
      call_id: session.callId,
      to: session.peerEmail
    });
    // 清理通话状态与媒体资源
    resetCallState();
  }, [resetCallState, sendMessage, session, stopRingtone]);

  // 挂断通话
  const endCall = useCallback(() => {
    // 没有会话时不处理
    if (!session) {
      return;
    }
    // 取消超时计时器并停止铃声
    clearCallTimeout();
    void stopRingtone();
    void finalizeRecording();
    // 通知对端结束通话
    sendMessage({
      type: "call.end",
      call_id: session.callId,
      to: session.peerEmail
    });
    // 清理通话状态与媒体资源
    resetCallState();
  }, [clearCallTimeout, finalizeRecording, resetCallState, sendMessage, session, stopRingtone]);

  // 向外暴露上下文能力
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
      isRecording,
      startRecording,
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
      isRecording,
      startRecording,
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
  // 供组件消费信令上下文的 Hook
  const ctx = useContext(SignalingContext);
  if (!ctx) {
    throw new Error("useSignaling must be used within SignalingProvider");
  }
  return ctx;
};
