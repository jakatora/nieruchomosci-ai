import { apiCall } from './api';

export interface Listing {
  id: string;
  source: string;
  source_id: string;
  url: string;
  title: string;
  description: string | null;
  price_pln: number | null;
  area_m2: number | null;
  price_per_m2: number | null;
  rooms: number | null;
  floor: number | null;
  city: string | null;
  district: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;
  photos: string[];
  published_at: string | null;
  status: string;
  // Dołączane przez GET /listings (inline fairness).
  price_fairness?: 'below' | 'fair' | 'above' | 'unknown';
  fairness_delta_pct?: number | null;
}

export interface Comparables {
  median_price_per_m2: number | null;
  sample_size: number;
  fairness_label: 'below' | 'fair' | 'above' | 'unknown';
  delta_pct: number | null;
  source: 'district' | 'city' | 'insufficient_data';
}

export interface InvestorAnalysis {
  listing_id: string;
  estimated_rent: number;
  yield_gross_pct: number;
  yield_net_pct: number;
  payback_years: number;
  cashflow_monthly: number;
  rent_source: string;
  assumptions: Record<string, number>;
  computed_at: string | null;
}

export async function listListings(query: {
  city?: string; district?: string;
  min_price?: number; max_price?: number;
  min_area?: number; max_area?: number;
  limit?: number; offset?: number;
  order_by?: 'recent' | 'price_asc' | 'price_desc' | 'ppm2_asc';
} = {}): Promise<{
  listings: Listing[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  tier_limit: number;
  paywall_truncated: boolean;
}> {
  return apiCall('/listings', { query });
}

export async function getListing(id: string): Promise<{
  listing: Listing;
  comparables: Comparables;
  investor_analysis: InvestorAnalysis | null;
  paywall_locked: string[];
}> {
  return apiCall(`/listings/${encodeURIComponent(id)}`);
}
