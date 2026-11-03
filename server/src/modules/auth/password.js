import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

// AUTH-06: argon2id (OWASP minimum parameters: 19 MiB, 2 passes, 1 lane).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummyHash;
/**
 * AUTH-12: when the email is unknown we still do one argon2 verify against a throwaway hash,
 * so an unknown email and a wrong password take about the same time.
 */
export async function verifyAgainstDummy(plain) {
  dummyHash ??= await hashPassword('dummy-password-for-timing-1');
  await verifyPassword(dummyHash, plain);
  return false;
}

// ADM-15: an unambiguous alphabet (no 0/O, 1/l/I) so a password read out over the phone is clear.
const TEMP_LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const TEMP_DIGITS = '23456789';
const TEMP_ALL = TEMP_LETTERS + TEMP_DIGITS;

/**
 * ADM-15: a one-time temporary password of 12 characters that always holds a letter and a digit,
 * so it passes the password rules. Random bytes come from crypto, never Math.random.
 */
export function generateTemporaryPassword() {
  const pick = (alphabet) => alphabet[randomInt(alphabet.length)];
  const chars = [pick(TEMP_LETTERS), pick(TEMP_DIGITS)];
  while (chars.length < 12) chars.push(pick(TEMP_ALL));
  // Shuffle (Fisher–Yates) so the required letter and digit are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
