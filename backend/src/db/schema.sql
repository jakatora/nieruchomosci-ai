-- NieruchomościAI — schemat bazy danych (SQLite). Idempotentny: CREATE ... IF NOT EXISTS.
-- Adaptowany z PrzetargAI schema.sql + delta dla dual segment + listings + geo + ROI.
-- Patrz reuse_plan.md § Schema delta po pełne uzasadnienie każdej zmiany.

-- ====================================================================
-- USERS — dual segment (Consumer + Investor). 3 plany: free / standard / investor.
-- ====================================================================
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,
  password_hash          TEXT,                              -- nullable: magic-link only OK
  user_type              TEXT NOT NULL DEFAULT 'consumer'
                           CHECK (user_type IN ('consumer', 'investor')),
  premium_tier           TEXT NOT NULL DEFAULT 'free'
                           CHECK (premium_tier IN ('free', 'standard', 'investor')),
  home_city              TEXT,
  search_radius_km       REAL NOT NULL DEFAULT 5,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  push_token             TEXT,
  push_platform          TEXT,                              -- 'ios' | 'android' | NULL
  notif_email            INTEGER NOT NULL DEFAULT 1,        -- 0/1
  notif_push             INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
-- Iter 5: webhook handlePaymentFailed wywołuje users.findByStripeCustomerId — bez indexu
-- O(n) full table scan przy każdej awaryjnej płatności. Z indexu — O(log n).
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- ====================================================================
-- LISTINGS — ogłoszenia mieszkaniowe z różnych źródeł (OLX w MVP).
-- Dedupe: (source, source_id). raw_data trzyma kompletny oryginał z RSS / API.
-- ====================================================================
CREATE TABLE IF NOT EXISTS listings (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,                            -- 'olx' (MVP) | 'otodom' (v2)
  source_id       TEXT NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  price_pln       REAL,
  area_m2         REAL,
  price_per_m2    REAL,                                     -- liczone w aplikacji
  rooms           INTEGER,
  floor           INTEGER,
  building_year   INTEGER,
  market          TEXT,                                     -- 'primary' | 'secondary' | NULL
  property_type   TEXT,                                     -- 'apartment' | 'studio' | 'house' | NULL
  city            TEXT NOT NULL,
  district        TEXT,
  street          TEXT,
  lat             REAL,
  lng             REAL,
  photos          TEXT NOT NULL DEFAULT '[]',               -- JSON: string[] (URLe oryginałów)
  raw_data        TEXT NOT NULL DEFAULT '{}',
  published_at    TEXT,
  fetched_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'sold', 'expired', 'removed')),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_city           ON listings(city);
CREATE INDEX IF NOT EXISTS idx_listings_city_district  ON listings(city, district);
CREATE INDEX IF NOT EXISTS idx_listings_fetched        ON listings(fetched_at);
CREATE INDEX IF NOT EXISTS idx_listings_published      ON listings(published_at);
CREATE INDEX IF NOT EXISTS idx_listings_geo            ON listings(lat, lng);
CREATE INDEX IF NOT EXISTS idx_listings_price_per_m2   ON listings(price_per_m2);

-- ====================================================================
-- SEARCHES — definicje obszarów wyszukiwania per user. Free tier: max 1 enabled.
-- ====================================================================
CREATE TABLE IF NOT EXISTS searches (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  districts       TEXT NOT NULL DEFAULT '[]',                -- JSON: string[]
  center_lat      REAL,
  center_lng      REAL,
  radius_km       REAL NOT NULL DEFAULT 5,
  min_price       REAL,
  max_price       REAL,
  min_area        REAL,
  max_area        REAL,
  rooms           TEXT NOT NULL DEFAULT '[]',                -- JSON: int[] (np. [1,2,3])
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_searches_user_enabled ON searches(user_id, enabled);

-- ====================================================================
-- MATCHES — wyniki dopasowania listings ↔ user.search. Z AI score + red flags + fair-price.
-- ====================================================================
CREATE TABLE IF NOT EXISTS matches (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  search_id        TEXT REFERENCES searches(id) ON DELETE SET NULL,
  listing_id       TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  match_reasoning  TEXT,
  price_fairness   TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (price_fairness IN ('below', 'fair', 'above', 'unknown')),
  fairness_delta_pct REAL,                                    -- procent vs mediana w okolicy
  red_flags        TEXT NOT NULL DEFAULT '[]',                -- JSON: {type, severity, text}[]
  scorer           TEXT NOT NULL DEFAULT 'ai',                -- 'ai' | 'heuristic'
  notified         INTEGER NOT NULL DEFAULT 0,
  user_seen        INTEGER NOT NULL DEFAULT 0,
  user_saved       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  UNIQUE (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user_created ON matches(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_matches_user_unseen  ON matches(user_id, user_seen);

-- ====================================================================
-- INVESTOR_ANALYSIS — cache drogiego ROI compute. 1 wpis per listing.
-- ====================================================================
CREATE TABLE IF NOT EXISTS investor_analysis (
  listing_id        TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  estimated_rent    REAL NOT NULL,                            -- PLN/mc
  yield_gross_pct   REAL NOT NULL,
  yield_net_pct     REAL NOT NULL,
  payback_years     REAL NOT NULL,
  cashflow_monthly  REAL NOT NULL,
  rent_source       TEXT NOT NULL,                            -- 'heuristic_v1' | 'user_override'
  assumptions       TEXT NOT NULL DEFAULT '{}',               -- JSON: rate, costs, vacancy_pct
  computed_at       TEXT NOT NULL
);

-- ====================================================================
-- GEOCODING_CACHE — cache Google Maps Geocoding (cost saver).
-- ====================================================================
CREATE TABLE IF NOT EXISTS geocoding_cache (
  query_hash   TEXT PRIMARY KEY,                              -- sha256(normalized address)
  query_text   TEXT NOT NULL,
  lat          REAL,
  lng          REAL,
  city         TEXT,
  district     TEXT,
  cached_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_cache_age ON geocoding_cache(cached_at);

-- ====================================================================
-- FEEDBACK — feedback usera do match (doskonalenie scoringu).
-- ====================================================================
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  helpful    INTEGER NOT NULL,                                -- 0/1
  reason     TEXT,                                             -- opcjonalny powód
  created_at TEXT NOT NULL,
  UNIQUE (user_id, match_id)
);

-- ====================================================================
-- AUDIT_LOGS — dziennik akcji (RODO + debug).
-- ====================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
-- Iter 5: query patterns w /admin/audit-logs (filter po action + aggregation last_24h_by_action).
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ====================================================================
-- AI_USAGE — zużycie i koszt AI (monitoring budżetu).
-- ====================================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id            TEXT PRIMARY KEY,
  operation     TEXT NOT NULL,                                -- 'match_scoring' | 'red_flags' | ...
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

-- ====================================================================
-- MAGIC_LINKS — jednorazowe linki (login + upgrade flow).
-- ====================================================================
CREATE TABLE IF NOT EXISTS magic_links (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,                                   -- 'login' | 'upgrade-standard' | 'upgrade-investor'
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_links_user ON magic_links(user_id);

-- ====================================================================
-- PROCESSED_WEBHOOKS — idempotency dla Stripe (i innych).
-- ====================================================================
CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id     TEXT PRIMARY KEY,
  source       TEXT NOT NULL,                                  -- 'stripe'
  processed_at TEXT NOT NULL
);

-- ====================================================================
-- KILL_SWITCHES — flagi do wyłączenia ficzerów bez deploya.
-- Przykładowe klucze: 'sources.olx', 'ai.matching', 'cron.daily', 'webhooks.stripe'.
-- ====================================================================
CREATE TABLE IF NOT EXISTS kill_switches (
  key        TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,                       -- 0=wyłączone, 1=włączone
  reason     TEXT,
  updated_at TEXT NOT NULL
);

-- ====================================================================
-- SUPPORT_TICKETS — proste in-app zgłoszenia od userów.
-- ====================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status, created_at);

-- ====================================================================
-- SCHEMA_META — wersjonowanie migracji.
-- ====================================================================
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
