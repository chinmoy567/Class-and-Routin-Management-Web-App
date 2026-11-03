import nodemailer from 'nodemailer';
import { logger } from '../../lib/logger.js';
import { getConfig } from '../../config.js';

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

// Tests only: replace the sender, for example to make a transport fail on purpose (EML-01).
let sendOverride = null;
export const setSendOverride = (fn) => {
  sendOverride = fn;
};

/** EML-02: every email leaves from the one system sender, MAIL_FROM. */
export async function deliver(message) {
  const config = getConfig();
  const full = { from: config.MAIL_FROM, ...message };
  if (sendOverride) return sendOverride(full);
  return createTransport(config).send(full);
}
