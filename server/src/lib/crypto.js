import crypto from 'node:crypto';
import { getConfig } from '../config.js';

const key = () => Buffer.from(getConfig().DATA_ENC_KEY, 'base64');

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, data] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function emailHmac(email) {
  return crypto
    .createHmac('sha256', getConfig().EMAIL_HMAC_KEY)
    .update(String(email).trim().toLowerCase())
    .digest('hex');
}

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
