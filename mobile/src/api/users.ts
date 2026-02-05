// 用户相关 API：个人信息、联系人、在线状态与改密
import { createApiClient } from "./client";

// 用户基础结构
export interface User {
  id: number;
  email: string;
  display_name: string;
}

// 在线状态结构
export interface PresenceRecord {
  email: string;
  online: boolean;
  last_seen: string | null;
}

// 获取当前登录用户
export const fetchMe = async (token: string) => {
  const api = createApiClient(token);
  const response = await api.get<{ user: User }>("/users/me");
  return response.data.user;
};

// 搜索用户（邮箱模糊匹配）
export const searchUsers = async (token: string, query: string) => {
  const api = createApiClient(token);
  const response = await api.get<{ results: User[] }>("/users/search", {
    params: { q: query }
  });
  return response.data.results;
};

// 获取联系人列表
export const listContacts = async (token: string) => {
  const api = createApiClient(token);
  const response = await api.get<{ contacts: User[] }>("/users/contacts");
  return response.data.contacts;
};

// 添加联系人
export const addContact = async (token: string, email: string) => {
  const api = createApiClient(token);
  await api.post("/users/contacts", { email });
};

// 删除联系人
export const removeContact = async (token: string, contactId: number) => {
  const api = createApiClient(token);
  await api.delete(`/users/contacts/${contactId}`);
};

// 批量获取在线状态
export const fetchPresence = async (token: string, emails: string[]) => {
  const api = createApiClient(token);
  const response = await api.get<{ presence: PresenceRecord[] }>(
    "/users/presence",
    {
      params: {
        emails: emails.join(",")
      }
    }
  );
  return response.data.presence;
};

// 改密请求体结构
export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
  confirm_password: string;
}

// 改密响应结构
export interface ChangePasswordResponse {
  message: string;
}

// 修改密码
export const changePassword = async (token: string, data: ChangePasswordRequest) => {
  const api = createApiClient(token);
  const response = await api.post<ChangePasswordResponse>("/users/change-password", data);
  return response.data;
};
