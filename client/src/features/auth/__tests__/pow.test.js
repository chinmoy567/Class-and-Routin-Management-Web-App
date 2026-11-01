import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { leadingZeroBits, solveChallenge } from '../pow.js';

describe('proof-of-work CAPTCHA (browser side)', () => {
  it('AUTH-14 counts leading zero bits', () => {
    expect(leadingZeroBits(Uint8Array.of(0xff))).toBe(0);
    expect(leadingZeroBits(Uint8Array.of(0x0f))).toBe(4);
    expect(leadingZeroBits(Uint8Array.of(0x00, 0x01))).toBe(15);
    expect(leadingZeroBits(Uint8Array.of(0x00, 0x00))).toBe(16);
  });

  it('AUTH-14 finds a solution the server accepts', async () => {
    const challenge = { prefix: 'abc123', bits: 12 };
    const solution = await solveChallenge(challenge);
    const digest = crypto.createHash('sha256').update(`${challenge.prefix}${solution}`).digest();
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(12);
  });
});
