const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/**
 * PRF-04: the real type of an image from its first bytes, never from the file name or the
 * Content-Type header. Returns 'image/jpeg', 'image/png', 'image/webp' or null.
 */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WebP: "RIFF" <size> "WEBP"
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}
