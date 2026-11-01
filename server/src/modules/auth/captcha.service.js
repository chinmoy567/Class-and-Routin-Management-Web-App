import crypto from 'node:crypto';
import { CaptchaChallenge } from './auth.model.js';
import { clock } from '../../lib/time.js';

// Self-hosted proof-of-work CAPTCHA. The browser must find a solution so that
// sha256(prefix + solution) starts with `bits` zero bits. Nothing for the person to solve,
// no third party. Swap `verifyCaptcha` to move to Turnstile or hCaptcha later.
export const CAPTCHA_BITS = 15;
export const CAPTCHA_TTL_MS = 5 * 60 * 1000;

export function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export const solves = (prefix, solution, bits) =>
  leadingZeroBits(crypto.createHash('sha256').update(`${prefix}${solution}`).digest()) >= bits;

export async function issueChallenge() {
  const prefix = crypto.randomBytes(12).toString('hex');
  const doc = await CaptchaChallenge.create({
    prefix,
    bits: CAPTCHA_BITS,
    expires_at: new Date(clock.now().getTime() + CAPTCHA_TTL_MS),
  });
  return { id: String(doc._id), prefix, bits: CAPTCHA_BITS };
}

/**
 * Check an answer. The challenge is used up first (one atomic update), so it works once even
 * when many requests send the same answer together.
 */
export async function verifyCaptcha(answer) {
  if (!answer?.id || !answer?.solution) return false;
  const now = clock.now();
  const challenge = await CaptchaChallenge.findOneAndUpdate(
    { _id: answer.id, used_at: null, expires_at: { $gt: now } },
    { $set: { used_at: now } },
    { returnDocument: 'before' },
  ).lean();
  if (!challenge) return false;
  return solves(challenge.prefix, answer.solution, challenge.bits);
}
