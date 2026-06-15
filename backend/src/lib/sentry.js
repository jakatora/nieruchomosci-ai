import * as Sentry from '@sentry/node';
import { env, features } from '../config/env.js';
import { logger } from './logger.js';

let enabled = false;

/** Inicjalizuje Sentry, jeśli skonfigurowano DSN. Wywołać jak najwcześniej. */
export function initSentry() {
  if (!features.sentry) {
    logger.warn('Sentry wyłączony — brak SENTRY_DSN_BACKEND');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN_BACKEND,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
  enabled = true;
  logger.info('Sentry zainicjalizowany');
}

/** Zgłasza wyjątek do Sentry (jeśli włączony). */
export function captureException(err, context) {
  if (enabled) Sentry.captureException(err, context ? { extra: context } : undefined);
}

export { Sentry, enabled as sentryEnabled };
