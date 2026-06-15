import { apiCall } from './api';

export interface Search {
  id: string;
  name: string;
  city: string;
  districts: string[];
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number;
  min_price: number | null;
  max_price: number | null;
  min_area: number | null;
  max_area: number | null;
  rooms: number[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function listSearches(): Promise<{
  searches: Search[];
  paywall: { free_tier_max_enabled: number; can_add_enabled: boolean };
}> {
  return apiCall('/searches');
}

export async function createSearch(input: Omit<Search, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<Search, 'enabled'>>): Promise<{ search: Search }> {
  return apiCall('/searches', { method: 'POST', body: input });
}

export async function updateSearch(id: string, patch: Partial<Search>): Promise<{ search: Search }> {
  return apiCall(`/searches/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export async function deleteSearch(id: string): Promise<{ ok: boolean }> {
  return apiCall(`/searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
