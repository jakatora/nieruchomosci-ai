import pino from 'pino';
import { env } from '../config/env.js';

const level = env.NODE_ENV === 'test'
  ? 'silent'
  : (process.env.LOG_LEVEL || 'info');

export const logger = pino({
  level,
  base: { app: 'nieruchomosciai-backend' },
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' } }
    : undefined,
});
