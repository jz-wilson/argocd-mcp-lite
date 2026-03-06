import { pino } from 'pino';
import { stderr } from 'process';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL?.toLowerCase() || 'info'
  },
  pino.destination(stderr)
);
