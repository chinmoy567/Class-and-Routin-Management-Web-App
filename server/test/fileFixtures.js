// Spec 21: fixture files for the chat-file tests. Zip containers are built here; the xlsx comes
// from ExcelJS so it is a real Office file. The legacy OLE files are stand-ins: they carry the
// OLE signature and the stream names Office uses, which is what the detector reads.
import zlib from 'node:zlib';
import ExcelJS from 'exceljs';

/** A zip archive with the given entries (stored, or deflated when `deflate` is set). */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate = false } of entries) {
    const nameBuf = Buffer.from(name);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const crc = zlib.crc32(data);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(body.length, 18);
    loc.writeUInt32LE(data.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(loc, nameBuf, body);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

const contentTypes = (mainType) =>
  Buffer.from(
    `<?xml version="1.0"?><Types><Override PartName="/x" ContentType="${mainType}"/></Types>`,
  );

export const DOCX = makeZip([
  {
    name: '[Content_Types].xml',
    data: contentTypes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    ),
    deflate: true,
  },
  { name: 'word/document.xml', data: Buffer.from('<w:document/>'), deflate: true },
]);

export const DOCM = makeZip([
  {
    name: '[Content_Types].xml',
    data: contentTypes('application/vnd.ms-word.document.macroEnabled.main+xml'),
  },
  { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
  { name: 'word/vbaProject.bin', data: Buffer.from('macro') },
]);

export const PPTX = makeZip([
  {
    name: '[Content_Types].xml',
    data: contentTypes(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    ),
  },
  { name: 'ppt/presentation.xml', data: Buffer.from('<p:presentation/>') },
]);

/** An xlsm in disguise: macro content type and a vbaProject part. */
export const XLSM = makeZip([
  {
    name: '[Content_Types].xml',
    data: contentTypes('application/vnd.ms-excel.sheet.macroEnabled.main+xml'),
  },
  { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
  { name: 'xl/vbaProject.bin', data: Buffer.from('macro') },
]);

/** A real .xlsx, written by ExcelJS. */
export async function realXlsx() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Routine').addRow(['CSE-301', 'Room 311']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const utf16 = (s) => Buffer.from(s, 'utf16le');
/** An OLE2 header followed by the stream names of the given Office kind. */
export function legacyOffice(kind, { macro = false } = {}) {
  const names = { doc: 'WordDocument', xls: 'Workbook', ppt: 'PowerPoint Document' }[kind];
  const parts = [
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(512 - 8),
    utf16(names),
    Buffer.alloc(16),
  ];
  if (macro) parts.push(utf16('_VBA_PROJECT'));
  return Buffer.concat(parts);
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
export const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200, 3)]);
export const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(200, 4),
]);
export const SVG = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
/** A Windows executable header (MZ) with binary padding. */
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0)]);
export const TXT = Buffer.from('Lecture notes: chapter 3, bring a calculator.\n');
/** The EICAR anti-virus test string. The test scanner treats it as malware. */
export const EICAR = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n',
);
