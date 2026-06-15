import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Katalog główny backendu (backend/) — config/ leży w backend/src/config. */
export const BACKEND_ROOT = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const schema = z.object({
  // --- Aplikacja ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default('NieruchomościAI'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LANDING_URL: z.string().url().default('https://nieruchomosciai.pl'),
  // Iter 41: CORS allowlist (CSV origins). Pusta = allow-all (dev), w prod ustaw konkretne.
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  // --- Auth ---
  JWT_SECRET: z.string().min(16, 'JWT_SECRET musi mieć min. 16 znaków'),
  JWT_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // --- AI ---
  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MATCH_MODEL: z.string().default('claude-haiku-4-5'),
  AI_REDFLAGS_MODEL: z.string().default('claude-haiku-4-5'),
  AI_BUDGET_SOFT_USD: z.coerce.number().nonnegative().default(200),
  AI_BUDGET_HARD_USD: z.coerce.number().nonnegative().default(500),

  // --- Stripe (2 plany) ---
  STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_STANDARD: z.string().default(''),
  STRIPE_PRICE_INVESTOR: z.string().default(''),

  // --- Fakturownia ---
  FAKTUROWNIA_API_KEY: z.string().default(''),
  FAKTUROWNIA_DOMAIN: z.string().default(''),

  // --- Email ---
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('NieruchomościAI <noreply@nieruchomosciai.pl>'),
  EMAIL_REPLY_TO: z.string().default('support@nieruchomosciai.pl'),
  EMAIL_DRY_RUN: z.coerce.number().int().min(0).max(1).default(0),

  // --- Geocoding ---
  GOOGLE_MAPS_API_KEY: z.string().default(''),
  GEOCODING_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // --- Sentry ---
  SENTRY_DSN_BACKEND: z.string().default(''),

  // --- Backup ---
  B2_ACCOUNT_ID: z.string().default(''),
  B2_APP_KEY: z.string().default(''),
  B2_BUCKET: z.string().default('nieruchomosciai-backups'),
  BACKUP_ENCRYPTION_KEY: z.string().default(''),

  // --- Admin ---
  ADMIN_API_KEY: z.string().default(''),

  // --- DB ---
  DATABASE_PATH: z.string().default('./data/data.db'),
  BACKUP_DIR: z.string().default(''),
  BACKUP_CRON: z.string().default('0 3 * * *'),
  BACKUP_RETENTION: z.coerce.number().int().positive().default(14),

  // --- Źródła ogłoszeń ---
  // CSV: 'domiporta' (MVP po DEC-007) | 'domiporta,olx' (v2 jeśli OLX wróci do RSS).
  SOURCES_ENABLED: z.string().default('domiporta'),
  // Shared User-Agent dla wszystkich źródeł (uczciwa identyfikacja z linkiem /about).
  // User-Agent musi być ASCII (Node fetch nie wpuści diakrytyków do nagłówków HTTP).
  SOURCES_USER_AGENT: z.string().default('NieruchomosciAI/1.0 (+https://nieruchomosciai.pl/about)'),
  // Per-source rate limit między requestami (np. między miastami w obrębie jednego źródła).
  DOMIPORTA_RATE_LIMIT_MS: z.coerce.number().int().nonnegative().default(3000),
  OLX_RATE_LIMIT_MS: z.coerce.number().int().nonnegative().default(5000),
  // DEPRECATED — używaj SOURCES_USER_AGENT. Trzymane dla wstecznej kompatybilności adaptera OLX.
  OLX_RSS_USER_AGENT: z.string().default('NieruchomosciAI/1.0 (+https://nieruchomosciai.pl/about)'),

  // --- Cron ---
  LISTINGS_FETCH_CRON: z.string().default('0 7 * * *'),
  MATCH_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(60),
  FREE_TIER_DAILY_MATCH_LIMIT: z.coerce.number().int().positive().default(3),

  // --- Rate limiting (Iter 12: konfigurowalne bez deploy) ---
  // Globalny limiter na większości routes (read-heavy endpointy).
  API_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  API_RATE_MAX: z.coerce.number().int().positive().default(120),
  // Auth endpointy (anti brute-force).
  AUTH_RATE_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60_000),
  AUTH_RATE_MAX: z.coerce.number().int().positive().default(30),
  // Landing demo (paste-listing-analysis) — anti AI cost abuse, 5/IP/24h.
  PASTE_DEMO_RATE_WINDOW_MS: z.coerce.number().int().positive().default(24 * 60 * 60_000),
  PASTE_DEMO_RATE_MAX: z.coerce.number().int().positive().default(5),

  // --- ROI ---
  ROI_VACANCY_PCT: z.coerce.number().nonnegative().default(5),
  ROI_MGMT_COST_PCT: z.coerce.number().nonnegative().default(8),
  ROI_MORTGAGE_RATE_PCT: z.coerce.number().nonnegative().default(7),
  ROI_DOWN_PAYMENT_PCT: z.coerce.number().nonnegative().default(20),
  ROI_MORTGAGE_YEARS: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Błędna konfiguracja środowiska (backend/.env):');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

/** Ścieżka pliku bazy danych rozwiązana względem katalogu backendu. */
export const DB_PATH = path.isAbsolute(env.DATABASE_PATH)
  ? env.DATABASE_PATH
  : path.resolve(BACKEND_ROOT, env.DATABASE_PATH);

/** Katalog kopii zapasowych — domyślnie obok pliku bazy (ten sam wolumen). */
export const BACKUP_DIR = env.BACKUP_DIR
  ? (path.isAbsolute(env.BACKUP_DIR) ? env.BACKUP_DIR : path.resolve(BACKEND_ROOT, env.BACKUP_DIR))
  : path.join(path.dirname(DB_PATH), 'backups');

/** Lista włączonych źródeł ogłoszeń (parsowana z CSV). */
export const sourcesEnabled = env.SOURCES_ENABLED
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Flagi funkcji — graceful degradation. Brak klucza API ⇒ usługa działa
 * w trybie ograniczonym zamiast wywracać cały backend.
 */
export const features = {
  ai: Boolean(env.ANTHROPIC_API_KEY),
  stripe: Boolean(env.STRIPE_SECRET_KEY),
  stripeStandard: Boolean(env.STRIPE_PRICE_STANDARD),
  stripeInvestor: Boolean(env.STRIPE_PRICE_INVESTOR),
  email: Boolean(env.RESEND_API_KEY) && env.EMAIL_DRY_RUN === 0,
  emailDryRun: env.EMAIL_DRY_RUN === 1,
  invoicing: Boolean(env.FAKTUROWNIA_API_KEY && env.FAKTUROWNIA_DOMAIN),
  sentry: Boolean(env.SENTRY_DSN_BACKEND),
  backups: Boolean(env.B2_ACCOUNT_ID && env.B2_APP_KEY),
  maps: Boolean(env.GOOGLE_MAPS_API_KEY),
};

/** Założenia ROI calculator — można nadpisać per user w UI / API. */
export const roiDefaults = {
  vacancyPct: env.ROI_VACANCY_PCT,
  mgmtCostPct: env.ROI_MGMT_COST_PCT,
  mortgageRatePct: env.ROI_MORTGAGE_RATE_PCT,
  downPaymentPct: env.ROI_DOWN_PAYMENT_PCT,
  mortgageYears: env.ROI_MORTGAGE_YEARS,
};
