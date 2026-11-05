// Spec 21, FIL-01 / FIL-02: a minimal zip reader for Office files (OOXML is a zip container).
// Reads the central directory and inflates named entries with node:zlib. Zip64 and encrypted
// entries are not supported: such files are refused by the caller.
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024; // zip bomb guard: no part we read may expand past this

/** Map of entry name → { method, compSize, size, offset }, or null when this is not a readable zip. */
export function readZipEntries(buf) {
  try {
    const minPos = Math.max(0, buf.length - 65557);
    let eocd = -1;
    for (let i = buf.length - 22; i >= minPos; i--) {
      if (buf.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10);
    const cenOffset = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cenOffset === 0xffffffff) return null; // zip64: not supported
    const entries = new Map();
    let p = cenOffset;
    for (let n = 0; n < count; n++) {
      if (buf.readUInt32LE(p) !== CEN_SIG) return null;
      const nameLen = buf.readUInt16LE(p + 28);
      entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), {
        method: buf.readUInt16LE(p + 10),
        compSize: buf.readUInt32LE(p + 20),
        size: buf.readUInt32LE(p + 24),
        offset: buf.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    return entries;
  } catch {
    return null;
  }
}

/** The uncompressed bytes of one entry, or null when it is missing, too big or unreadable. */
export function readZipEntry(buf, entries, name) {
  const e = entries.get(name);
  if (!e || e.size > MAX_ENTRY_BYTES) return null;
  try {
    if (buf.readUInt32LE(e.offset) !== LOC_SIG) return null;
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    return null;
  } catch {
    return null;
  }
}
