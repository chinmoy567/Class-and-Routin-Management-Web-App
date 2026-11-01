import nodemailer from 'nodemailer';
import { logger } from '../../lib/logger.js';

const outbox = [];
export const getOutbox = () => outbox;
export const clearOutbox = () => {
  outbox.length = 0;
};

/**
 * FND-24: in development and test, emails go to the log and the in-memory outbox.
 * In production they go out over SMTP.
 */
export function createTransport(config) {
  if (config.NODE_ENV === 'production') {
    const smtp = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
    return { send: (message) => smtp.sendMail({ from: config.MAIL_FROM, ...message }) };
  }
  return {
    async send(message) {
      outbox.push({ from: config.MAIL_FROM, ...message });
      logger.info({ subject: message.subject }, 'email written to outbox');
    },
  };
}
