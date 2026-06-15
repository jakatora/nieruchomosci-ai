import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { Sentry, sentryEnabled } from './lib/sentry.js';
import { requestId } from './middleware/requestId.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import listingsRouter from './routes/listings.js';
import searchesRouter from './routes/searches.js';
import investorRouter from './routes/investor.js';
import contentRouter from './routes/content.js';
import upgradeRouter from './routes/upgrade.js';
import webhooksRouter from './routes/webhooks.js';
import adminRouter from './routes/admin.js';
import legalRouter from './routes/legal.js';

/**
 * Express application — montuje routery w odpowiedniej kolejności:
 *
 *   1. /webhooks — PRZED express.json() (Stripe wymaga surowego body do weryfikacji podpisu).
 *   2. express.json() — parser JSON dla pozostałych endpointów.
 *   3. Statyczne / HTML / API routery.
 *
 * Rate limit'ery:
 *   - apiLimiter: 120 req/min (większość endpointów)
 *   - authLimiter: 30 req/15min (anti-brute-force na /auth/*)
 *   - /content ma własny anti-abuse limiter wewnątrz routera (5/IP/24h)
 */
/**
 * Iter 41: Buduje CORS options z env.CORS_ALLOWED_ORIGINS allowlist.
 *
 * - Pusta lista → allow-all (dev convenience). W prod ustaw CSV: "https://nieruchomosciai.pl,https://...".
 * - `null` origin (curl, server-to-server, react-native fetch z Expo) → zawsze allowed.
 * - Mismatch → CORS error (403 w preflight).
 *
 * Exportowane dla testów. NIE używaj bezpośrednio — `createApp()` używa.
 */
export function buildCorsOptions(envConfig) {
  const raw = (envConfig.CORS_ALLOWED_ORIGINS || '').trim();
  const allowList = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  return {
    exposedHeaders: ['X-Request-Id'],
    origin: (origin, callback) => {
      // null/undefined origin = server-to-server albo same-origin → allow
      if (!origin) return callback(null, true);
      // Pusta allowlist = allow-all (dev)
      if (!allowList) return callback(null, true);
      // Allowlist match
      if (allowList.includes(origin)) return callback(null, true);
      // Wildcard prefix support: "https://*.nieruchomosciai.pl"
      for (const pattern of allowList) {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          if (regex.test(origin)) return callback(null, true);
        }
      }
      callback(new Error(`CORS: origin ${origin} nie jest na allowlist`));
    },
    credentials: true,
  };
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Iter 48: CSP allowlist per-route — strict default, relaxed dla HTML routes.
  // Default helmet CSP: tylko same-origin (zero CDN). To OK dla API responses (JSON).
  app.use(helmet());

  // /upgrade + /legal renderują HTML z Tailwind CDN. CSP dla tych routes pozwala na cdn.tailwindcss.com.
  const htmlCsp = helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'cdn.tailwindcss.com', "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"], // Tailwind injects styles inline
      'img-src': ["'self'", 'data:', 'galeria.domiporta.pl'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"], // anti-clickjacking
    },
  });
  app.use('/upgrade', htmlCsp);
  app.use('/legal', htmlCsp);
  app.use(cors(buildCorsOptions(env)));
  // Iter 16: każdy request dostaje X-Request-Id (UUID albo z headera klienta).
  app.use(requestId);

  // KRYTYCZNE: /webhooks PRZED express.json() — Stripe wymaga raw body do verify signature.
  app.use('/webhooks', webhooksRouter);

  // Iter 12: limits konfigurowalne przez env vars (API_RATE_*, AUTH_RATE_*).
  const apiLimiter = rateLimit({
    windowMs: env.API_RATE_WINDOW_MS,
    max: env.API_RATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: env.AUTH_RATE_WINDOW_MS,
    max: env.AUTH_RATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Iter 46: per-route body size limits (security — anti-DoS).
  // GET endpointy NIE używają body, więc nie potrzebują parsera (jeszcze bardziej tight).
  const tinyJson = express.json({ limit: '4kb' });    // /content paste (URL field)
  const smallJson = express.json({ limit: '32kb' });  // /auth/* /upgrade/checkout
  const mediumJson = express.json({ limit: '128kb' });// /searches /admin /investor (z reason fields)
  const defaultJson = express.json({ limit: '256kb' });

  app.use('/health', healthRouter);
  app.use('/auth', authLimiter, smallJson, authRouter);
  app.use('/listings', apiLimiter, defaultJson, listingsRouter);
  app.use('/searches', apiLimiter, mediumJson, searchesRouter);
  app.use('/investor', apiLimiter, mediumJson, investorRouter);
  app.use('/content', tinyJson, contentRouter);
  app.use('/upgrade', apiLimiter, smallJson, upgradeRouter);
  app.use('/legal', legalRouter);
  app.use('/admin', mediumJson, adminRouter);

  app.use(notFoundHandler);
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}
