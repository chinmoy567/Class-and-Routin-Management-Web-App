// The browser half of the self-hosted CAPTCHA: find a number so that sha256(prefix + number)
// starts with `bits` zero bits. It takes about a second and needs nothing from the person.

export function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

const CHUNK = 256;

export async function solveChallenge({ prefix, bits }) {
  const encoder = new TextEncoder();
  const digestOf = async (n) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${prefix}${n}`)));
  for (let start = 0; ; start += CHUNK) {
    const batch = await Promise.all(Array.from({ length: CHUNK }, (_, i) => digestOf(start + i)));
    const hit = batch.findIndex((digest) => leadingZeroBits(digest) >= bits);
    if (hit !== -1) return String(start + hit);
  }
}
