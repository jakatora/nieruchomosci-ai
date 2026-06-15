import { apiCall, setAuthToken } from './api';
import { saveToken, clearToken } from './storage';

export interface User {
  id: string;
  email: string;
  user_type: 'consumer' | 'investor';
  premium_tier: 'free' | 'standard' | 'investor';
  home_city: string | null;
  search_radius_km: number;
  notif_email: boolean;
  notif_push: boolean;
  created_at: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

export async function register(input: {
  email: string;
  password: string;
  user_type: 'consumer' | 'investor';
  home_city?: string;
  search_radius_km?: number;
}): Promise<User> {
  const res = await apiCall<AuthResponse>('/auth/register', {
    method: 'POST',
    body: input,
  });
  await saveToken(res.token);
  setAuthToken(res.token);
  return res.user;
}

export async function login(email: string, password: string): Promise<User> {
  const res = await apiCall<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  await saveToken(res.token);
  setAuthToken(res.token);
  return res.user;
}

export async function requestMagicLogin(email: string): Promise<void> {
  await apiCall<{ ok: boolean }>('/auth/login/magic', {
    method: 'POST',
    body: { email },
  });
}

export async function consumeMagicLogin(token: string): Promise<User> {
  const res = await apiCall<AuthResponse>('/auth/login/magic/consume', {
    method: 'POST',
    body: { token },
  });
  await saveToken(res.token);
  setAuthToken(res.token);
  return res.user;
}

export async function fetchMe(): Promise<User> {
  const res = await apiCall<{ user: User }>('/auth/me');
  return res.user;
}

export async function updateProfile(input: Partial<User>): Promise<User> {
  const res = await apiCall<{ user: User }>('/auth/me', {
    method: 'PATCH',
    body: input,
  });
  return res.user;
}

export async function updateNotifPrefs(input: { notif_email?: boolean; notif_push?: boolean }): Promise<User> {
  const res = await apiCall<{ user: User }>('/auth/me/notif-prefs', {
    method: 'PUT',
    body: input,
  });
  return res.user;
}

export async function setPushToken(push_token: string, platform: 'ios' | 'android'): Promise<void> {
  await apiCall('/auth/me/push-token', {
    method: 'PUT',
    body: { push_token, platform },
  });
}

export async function requestUpgradeLink(plan: 'standard' | 'investor'): Promise<{ url: string }> {
  return apiCall<{ url: string; token: string; plan: string }>('/auth/upgrade-link', {
    method: 'POST',
    body: { plan },
  });
}

export async function logout(): Promise<void> {
  await clearToken();
  setAuthToken(null);
}
