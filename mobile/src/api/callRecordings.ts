// 通话录音 API：发起录音、上传音频、获取摘要详情
import * as FileSystem from "expo-file-system";

import { API_BASE_URL } from "../config";
import { createApiClient } from "./client";

// 单条转写片段
export interface TranscriptSegment {
  speaker: "A" | "B";
  start_ms: number;
  end_ms: number;
  text: string;
}

// 录音详情结构
export interface CallRecordingDetail {
  call_id: string;
  status: string;
  target_lang: "zh" | "en";
  transcript: TranscriptSegment[];
  summary_text: string;
  translated_transcript: string;
  translated_summary: string;
  error_message: string;
}

// 发起录音会话（仅录音发起者调用）
export const startRecording = async (
  token: string,
  callId: string,
  targetLang: "zh" | "en"
) => {
  const api = createApiClient(token);
  const response = await api.post<{ call_id: string; status: string }>(
    "/users/call-recordings/start",
    {
      call_id: callId,
      target_lang: targetLang
    }
  );
  return response.data;
};

// 上传录音文件（双方各自上传）
export const uploadRecording = async (
  token: string,
  callId: string,
  fileUri: string,
  mimeType = "audio/m4a"
) => {
  if (!fileUri) {
    throw new Error("recording file uri missing");
  }
  const url = `${API_BASE_URL}/users/call-recordings/${callId}/upload`;
  const result = await FileSystem.uploadAsync(url, fileUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "audio",
    mimeType,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`upload failed: ${result.status} ${result.body}`);
  }

  try {
    return JSON.parse(result.body) as { call_id: string; status: string };
  } catch (error) {
    throw new Error(`invalid upload response: ${result.body}`);
  }
};

// 获取录音详情（仅录音发起者）
export const fetchRecording = async (token: string, callId: string) => {
  const api = createApiClient(token);
  const response = await api.get<{ recording: CallRecordingDetail }>(
    `/users/call-recordings/${callId}`
  );
  return response.data.recording;
};
