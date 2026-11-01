import crypto from 'node:crypto';

// RFC 6238 time-based one-time passwords: 6 digits, 30 second step, SHA-1 (what authenticator apps use).
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

export function base32Decode(text) {
  let bits = '';
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) throw new Error('Invalid base32 character');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretBytes, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBytes).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code for the 30 second step that contains `now` (a Date), shifted by `stepOffset` steps. */
export function totpCode(secret, now, stepOffset = 0) {
  const counter = Math.floor(now.getTime() / 1000 / STEP_SECONDS) + stepOffset;
  return hotp(base32Decode(secret), counter);
}

/** AUTH-18: accepts the current step and one step either side (±1). */
export function verifyTotp(secret, code, now) {
  if (!/^\d{6}$/.test(String(code))) return false;
  let ok = false;
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, now, offset));
    const given = Buffer.from(String(code));
    // no early exit: every step is compared
    ok = crypto.timingSafeEqual(expected, given) || ok;
  }
  return ok;
}

export function otpauthUrl({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query}`;
}
