import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { initSentry } from './lib/sentry.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

initSentry();
migrate();

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `${env.APP_NAME} backend wystartował → http://localhost:${env.PORT}`,
  );
});

startScheduler();

/** Łagodne zamknięcie — zatrzymuje scheduler i serwer HTTP. */
function shutdown(signal) {
  logger.info({ signal }, 'Zamykanie serwera...');
  stopScheduler();
  server.close(() => {
    logger.info('Serwer zamknięty poprawnie');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Nieobsłużone odrzucenie obietnicy');
});
