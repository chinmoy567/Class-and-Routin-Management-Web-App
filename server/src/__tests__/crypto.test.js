import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, emailHmac, randomToken, hashToken } from '../lib/crypto.js';

describe('crypto', () => {
  it('FND-14 encrypt then decrypt returns the original text', () => {
    expect(decrypt(encrypt('student@baiust.ac.bd'))).toBe('student@baiust.ac.bd');
  });

  it('FND-14 two encryptions of the same text differ, and are iv.tag.data', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(a.split('.')).toHaveLength(3);
  });

  it('FND-14 a tampered blob fails to decrypt', () => {
    const [iv, tag, data] = encrypt('secret').split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('FND-14 emailHmac ignores case and surrounding spaces', () => {
    expect(emailHmac('  A@Baiust.ac.bd ')).toBe(emailHmac('a@baiust.ac.bd'));
    expect(emailHmac('a@baiust.ac.bd')).not.toBe(emailHmac('b@baiust.ac.bd'));
  });

  it('FND-14 randomToken is url-safe and unique; hashToken is stable', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
});
