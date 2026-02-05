// 聊天页面：展示历史消息并发送文本/表情
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { RootStackParamList } from "../navigation/AppNavigator";
import { useSignaling, ChatMessage } from "../context/SignalingContext";
import { useLanguage } from "../context/LanguageContext";

// 路由参数类型
type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

// 常用表情列表
const EMOJIS = [
  "😀",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "🥳",
  "😎",
  "😅",
  "😭",
  "😡",
  "👍",
  "🙏",
  "🎉",
  "❤️",
  "🔥"
];

// 聊天页组件
const ChatScreen: React.FC<Props> = ({ route }) => {
  const { peerEmail, peerName } = route.params;
  const { chatMessages, sendChatMessage, loadChatHistory } = useSignaling();
  const { t } = useLanguage();
  // 输入与显示状态
  const [message, setMessage] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 当前会话消息列表
  const messages = useMemo(
    () => chatMessages[peerEmail] ?? [],
    [chatMessages, peerEmail]
  );

  // 时间格式化
  const formatTime = useCallback((value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }, []);

  // 发送消息
  const handleSend = useCallback(() => {
    if (!message.trim()) {
      return;
    }
    sendChatMessage(peerEmail, message);
    setMessage("");
  }, [message, peerEmail, sendChatMessage]);

  // 点击表情追加到输入框
  const handleEmojiPress = useCallback((emoji: string) => {
    setMessage((current) => `${current}${emoji}`);
  }, []);

  // 新消息到达后滚动到底部
  useEffect(() => {
    if (!messages.length) {
      return;
    }
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages.length]);

  // 进入页面时加载历史记录
  useEffect(() => {
    void loadChatHistory(peerEmail);
  }, [loadChatHistory, peerEmail]);

  // 渲染单条消息（区分左右与样式）
  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isOutgoing = item.direction === "outgoing";
      const timeLabel = formatTime(item.sentAt);
      return (
        <View
          style={[
            styles.messageRow,
            isOutgoing ? styles.messageRowRight : styles.messageRowLeft
          ]}
        >
          <Text
            style={[
              styles.messageTime,
              isOutgoing ? styles.messageTimeRight : styles.messageTimeLeft
            ]}
          >
            {timeLabel}
          </Text>
          <View
            style={[
              styles.bubble,
              isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming
            ]}
          >
            <Text
              style={[
                styles.messageText,
                isOutgoing ? styles.textOutgoing : styles.textIncoming
              ]}
            >
              {item.body}
            </Text>
          </View>
        </View>
      );
    },
    [formatTime]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      {/* 顶部会话信息 */}
      <View style={styles.header}>
        <Text style={styles.name}>{peerName || peerEmail}</Text>
        <Text style={styles.email}>{peerEmail}</Text>
      </View>

      {/* 消息列表 */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{t("chat_empty")}</Text>
        }
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: true })
        }
      />

      {/* 表情面板 */}
      {showEmoji ? (
        <View style={styles.emojiPanel}>
          {EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={styles.emojiButton}
              onPress={() => handleEmojiPress(emoji)}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* 输入区 */}
      <View style={styles.inputRow}>
        <TouchableOpacity
          style={styles.emojiToggle}
          onPress={() => setShowEmoji((current) => !current)}
        >
          <Text style={styles.emojiToggleText}>{t("chat_emoji_toggle")}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder={t("chat_input_placeholder")}
          placeholderTextColor="#9ca3af"
          value={message}
          onChangeText={setMessage}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            message.trim() ? styles.sendButtonActive : styles.sendButtonDisabled
          ]}
          onPress={handleSend}
          disabled={!message.trim()}
        >
          <Text style={styles.sendButtonText}>{t("chat_send_button")}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6"
  },
  header: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#fff"
  },
  name: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827"
  },
  email: {
    marginTop: 4,
    fontSize: 12,
    color: "#9ca3af"
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    flexGrow: 1
  },
  emptyText: {
    textAlign: "center",
    color: "#9ca3af",
    marginTop: 20
  },
  messageRow: {
    marginBottom: 14,
    maxWidth: "80%"
  },
  messageRowLeft: {
    alignSelf: "flex-start"
  },
  messageRowRight: {
    alignSelf: "flex-end"
  },
  messageTime: {
    fontSize: 11,
    marginBottom: 6,
    color: "#9ca3af"
  },
  messageTimeLeft: {
    textAlign: "left"
  },
  messageTimeRight: {
    textAlign: "right"
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14
  },
  bubbleIncoming: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb"
  },
  bubbleOutgoing: {
    backgroundColor: "#2563eb"
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20
  },
  textIncoming: {
    color: "#111827"
  },
  textOutgoing: {
    color: "#fff"
  },
  emojiPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb"
  },
  emojiButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6"
  },
  emojiText: {
    fontSize: 20
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb"
  },
  emojiToggle: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    marginRight: 8
  },
  emojiToggleText: {
    fontSize: 12,
    color: "#2563eb",
    fontWeight: "600"
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: "#f9fafb",
    color: "#111827"
  },
  sendButton: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12
  },
  sendButtonActive: {
    backgroundColor: "#2563eb"
  },
  sendButtonDisabled: {
    backgroundColor: "#cbd5f5"
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600"
  }
});

export default ChatScreen;
