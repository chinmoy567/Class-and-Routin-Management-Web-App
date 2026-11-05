// Spec 21: a small multipart/form-data reader for one upload (a file and an optional caption).
// The whole body is already capped by express.raw, so this works on a Buffer. No library.
const MAX_PARTS = 10;

/**
 * Parts of a multipart body as `{ name, filename, contentType, data }`, or null when the body
 * is not valid multipart.
 */
export function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType ?? ''));
  if (!match || !Buffer.isBuffer(body)) return null;
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
  let pos = body.indexOf(boundary);
  if (pos < 0) return null;
  pos += boundary.length;
  const parts = [];
  for (;;) {
    const marker = body.toString('latin1', pos, pos + 2);
    if (marker === '--') break; // closing boundary
    if (marker !== '\r\n') return null;
    pos += 2;
    const next = body.indexOf(boundary, pos);
    if (next < 0 || next - 2 < pos) return null;
    const part = parsePart(body.subarray(pos, next - 2));
    if (!part) return null;
    parts.push(part);
    if (parts.length > MAX_PARTS) return null;
    pos = next + boundary.length;
  }
  return parts;
}

function parsePart(part) {
  const split = part.indexOf('\r\n\r\n');
  if (split < 0) return null;
  const headers = part.toString('utf8', 0, split);
  const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? '';
  return {
    name: /\bname="([^"]*)"/i.exec(disposition)?.[1],
    filename: /\bfilename="([^"]*)"/i.exec(disposition)?.[1],
    contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim(),
    data: part.subarray(split + 4),
  };
}
