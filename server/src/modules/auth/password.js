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
