import { describe, it, expect } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from '../totp.js';

// RFC 6238 appendix B: ASCII secret "12345678901234567890", SHA-1, 8 digits. We use the last 6.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('AUTH-18 matches the RFC 6238 test vectors (last six digits)', () => {
    const vectors = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpCode(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
    }
  });

  it('AUTH-18 base32 round-trips and secrets are random', () => {
    const bytes = Buffer.from('hello world');
    expect(base32Decode(base32Encode(bytes)).toString()).toBe('hello world');
    expect(generateSecret()).not.toBe(generateSecret());
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('AUTH-18 accepts the current step and one step either side, not two', () => {
    const now = new Date(1_700_000_000_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now, -1), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now, 1), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now, 2), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now, -2), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);
  });

  it('AUTH-18 builds an otpauth url an authenticator app can read', () => {
    const url = otpauthUrl({ secret: 'ABC', account: 'a@baiust.ac.bd', issuer: 'BAIUST Routine' });
    expect(url).toMatch(/^otpauth:\/\/totp\/BAIUST%20Routine:a%40baiust\.ac\.bd\?/);
    expect(url).toContain('secret=ABC');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });
});
