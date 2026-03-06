import { cmd } from './cmd/cmd.js';
import { logger } from './logging/logging.js';
import dotenv from 'dotenv';

dotenv.config();

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

cmd();
