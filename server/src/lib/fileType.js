// Spec 21, FIL-01 / FIL-02: the real type of a chat file from its content, never from its name or
// the browser's Content-Type. Returns the MIME type for an allowed file, or null for anything else
// (including SVG and macro-enabled Office files, even when renamed).
import { readZipEntries, readZipEntry } from './zip.js';
import { sniffImage } from './imageType.js';

const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];
const utf16 = (s) => Buffer.from(s, 'utf16le');

const startsWith = (buf, bytes) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

export const MIME = Object.freeze({
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
});

/** The MIME type of an allowed file, or null. */
export function detectAllowedFile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  const image = sniffImage(buf);
  if (image) return MIME[image.replace('image/', '')];
  if (/^GIF8[79]a/.test(buf.toString('latin1', 0, 6))) return MIME.gif;
  if (buf.toString('latin1', 0, 5) === '%PDF-') return MIME.pdf;
  if (startsWith(buf, ZIP_SIG)) return detectOoxml(buf);
  if (startsWith(buf, OLE_SIG)) return detectLegacyOffice(buf);
  return detectText(buf);
}

/** docx, xlsx or pptx from [Content_Types].xml. Any macro-enabled package is refused (FIL-02). */
function detectOoxml(buf) {
  const entries = readZipEntries(buf);
  if (!entries) return null;
  const hasMacroPart = [...entries.keys()].some((name) => /vbaProject\.bin$/i.test(name));
  const contentTypes = readZipEntry(buf, entries, '[Content_Types].xml');
  if (!contentTypes) return null;
  const xml = contentTypes.toString('utf8');
  if (hasMacroPart || /macroEnabled/i.test(xml)) return null;
  if (/wordprocessingml\.document\.main\+xml/.test(xml)) return MIME.docx;
  if (/spreadsheetml\.sheet\.main\+xml/.test(xml)) return MIME.xlsx;
  if (/presentationml\.presentation\.main\+xml/.test(xml)) return MIME.pptx;
  return null;
}

/**
 * doc, xls or ppt from the OLE stream names. A VBA project (its storage names) is refused.
 * The names are matched as UTF-16 text, as OLE stores them.
 */
function detectLegacyOffice(buf) {
  if (buf.includes(utf16('_VBA_PROJECT')) || buf.includes(utf16('Macros'))) return null;
  if (buf.includes(utf16('PowerPoint Document'))) return MIME.ppt;
  if (buf.includes(utf16('WordDocument'))) return MIME.doc;
  if (buf.includes(utf16('Workbook')) || buf.includes(utf16('Book'))) return MIME.xls;
  return null;
}

/** Plain text: valid UTF-8 with no binary control bytes, and no SVG markup anywhere in it. */
function detectText(buf) {
  for (const byte of buf) {
    if (byte === 0 || (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(byte))) return null;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return null;
  }
  if (/<svg[\s>/]/i.test(text)) return null; // FIL-02: SVG, even renamed to .txt
  return MIME.txt;
}
