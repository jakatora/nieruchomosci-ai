import { apiCall } from './api';
import type { Listing, InvestorAnalysis } from './listings';

export interface InvestorRanking {
  listing: Listing;
  investor_analysis: InvestorAnalysis;
  fairness: {
    label: 'below' | 'fair' | 'above' | 'unknown';
    delta_pct: number | null;
    median_price_per_m2: number | null;
    sample_size: number;
  };
}

export async function fetchInvestorDashboard(query: {
  city?: string;
  district?: string;
  sort_by?: 'yield_net' | 'yield_gross' | 'payback' | 'cashflow';
  limit?: number;
  min_yield_net?: number;
  min_price?: number;
  max_price?: number;
  min_area?: number;
  max_area?: number;
} = {}): Promise<{
  summary: Record<string, number | string | null>;
  rankings: InvestorRanking[];
  filters_applied: Record<string, unknown>;
}> {
  return apiCall('/investor/analysis', { query });
}
