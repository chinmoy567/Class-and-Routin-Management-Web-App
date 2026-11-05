import { describe, it, expect } from 'vitest';
import { detectAllowedFile, MIME } from '../fileType.js';
import { sanitiseFileName } from '../fileName.js';
import { parseMultipart } from '../multipart.js';
import * as f from '../../../test/fileFixtures.js';

// FIL-01: the type comes from the content. The name and the browser's type never count.
describe('FIL-01 detectAllowedFile', () => {
  it('FIL-01 detects each allowed type from its bytes', async () => {
    expect(detectAllowedFile(f.PDF)).toBe(MIME.pdf);
    expect(detectAllowedFile(f.DOCX)).toBe(MIME.docx);
    expect(detectAllowedFile(f.PPTX)).toBe(MIME.pptx);
    expect(detectAllowedFile(await f.realXlsx())).toBe(MIME.xlsx);
    expect(detectAllowedFile(f.legacyOffice('doc'))).toBe(MIME.doc);
    expect(detectAllowedFile(f.legacyOffice('xls'))).toBe(MIME.xls);
    expect(detectAllowedFile(f.legacyOffice('ppt'))).toBe(MIME.ppt);
    expect(detectAllowedFile(f.TXT)).toBe(MIME.txt);
    expect(detectAllowedFile(f.JPEG)).toBe(MIME.jpeg);
    expect(detectAllowedFile(f.PNG)).toBe(MIME.png);
    expect(detectAllowedFile(f.GIF)).toBe(MIME.gif);
    expect(detectAllowedFile(f.WEBP)).toBe(MIME.webp);
  });

  it('FIL-01 a PDF renamed to .jpg is still a PDF (the name is never read)', () => {
    // The caller passes only bytes, so a renamed file is the same bytes: the type is PDF.
    expect(detectAllowedFile(f.PDF)).toBe(MIME.pdf);
  });

  it('FIL-01 an executable renamed to .pdf is refused', () => {
    expect(detectAllowedFile(f.EXE)).toBeNull();
  });

  it('FIL-01 a zip that is not an Office file is refused', () => {
    const plain = f.makeZip([{ name: 'readme.txt', data: Buffer.from('hi') }]);
    expect(detectAllowedFile(plain)).toBeNull();
  });

  it('FIL-01 an Office zip with no known main content type is refused', () => {
    const odd = f.makeZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'other.xml', data: Buffer.from('x') },
    ]);
    expect(detectAllowedFile(odd)).toBeNull();
  });

  it('FIL-01 an empty file and a non-buffer are refused', () => {
    expect(detectAllowedFile(Buffer.alloc(0))).toBeNull();
    expect(detectAllowedFile('text')).toBeNull();
  });

  it('FIL-01 binary data that is not text, PDF or Office is refused', () => {
    expect(detectAllowedFile(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]))).toBeNull();
  });

  it('FIL-01 text that is not valid UTF-8 is refused', () => {
    expect(detectAllowedFile(Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x80]))).toBeNull();
  });

  it('FIL-01 compressed Office entries are read (deflate) and detected', () => {
    expect(detectAllowedFile(f.DOCX)).toBe(MIME.docx);
  });
});

// FIL-02: SVG and macro-enabled Office files are refused, even when renamed.
describe('FIL-02 refused types', () => {
  it('FIL-02 an SVG is refused', () => {
    expect(detectAllowedFile(f.SVG)).toBeNull();
  });

  it('FIL-02 an SVG renamed to .txt is refused (it is text by content)', () => {
    expect(detectAllowedFile(Buffer.from('<svg xmlns="x"></svg>'))).toBeNull();
    expect(detectAllowedFile(Buffer.from('notes <SVG > here'))).toBeNull();
  });

  it('FIL-02 a .docm renamed to .docx is refused (macro content type)', () => {
    expect(detectAllowedFile(f.DOCM)).toBeNull();
  });

  it('FIL-02 an .xlsm renamed to .xlsx is refused (vbaProject part)', () => {
    expect(detectAllowedFile(f.XLSM)).toBeNull();
  });

  it('FIL-02 a legacy Office file with a VBA project is refused', () => {
    expect(detectAllowedFile(f.legacyOffice('doc', { macro: true }))).toBeNull();
    expect(detectAllowedFile(f.legacyOffice('xls', { macro: true }))).toBeNull();
  });

  it('FIL-02 a legacy Office file that is neither Word, Excel nor PowerPoint is refused', () => {
    const odd = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(64),
    ]);
    expect(detectAllowedFile(odd)).toBeNull();
  });
});

describe('sanitiseFileName (FIL-09)', () => {
  it('FIL-09 drops path parts and characters that are unsafe in a name', () => {
    expect(sanitiseFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFileName('C:\\Users\\me\\notes<1>.pdf')).toBe('notes1.pdf');
    expect(sanitiseFileName('a"b|c?d*e.txt')).toBe('abcde.txt');
  });

  it('FIL-09 removes control characters and leading dots, and tidies spaces', () => {
    expect(sanitiseFileName('\u0000..hidden\tfile   name.pdf')).toBe('hidden file name.pdf');
  });

  it('FIL-09 falls back to "file" when nothing is left', () => {
    expect(sanitiseFileName('///')).toBe('file');
    expect(sanitiseFileName(undefined)).toBe('file');
  });

  it('FIL-09 keeps at most 120 characters and keeps the extension', () => {
    const name = `${'x'.repeat(200)}.pdf`;
    const out = sanitiseFileName(name);
    expect(out.length).toBe(120);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('parseMultipart', () => {
  const boundary = 'BOUNDARY123';
  const type = `multipart/form-data; boundary=${boundary}`;
  const body = (...parts) =>
    Buffer.from(
      parts.map((p) => `--${boundary}\r\n${p}\r\n`).join('') + `--${boundary}--\r\n`,
      'latin1',
    );

  it('reads a file part and a caption part', () => {
    const parts = parseMultipart(
      body(
        'Content-Disposition: form-data; name="caption"\r\n\r\nWeek 4 slides',
        'Content-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4',
      ),
      type,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].name).toBe('caption');
    expect(parts[0].data.toString()).toBe('Week 4 slides');
    expect(parts[1]).toMatchObject({
      name: 'file',
      filename: 'a.pdf',
      contentType: 'application/pdf',
    });
    expect(parts[1].data.toString()).toBe('%PDF-1.4');
  });

  it('keeps binary bytes exactly, including CRLF inside the file', () => {
    const bin = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0x0d, 0x0a]);
    const raw = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\n\r\n`,
      ),
      bin,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    expect(parseMultipart(raw, type)[0].data.equals(bin)).toBe(true);
  });

  it('accepts a quoted boundary', () => {
    const quoted = `multipart/form-data; boundary="${boundary}"`;
    expect(
      parseMultipart(body('Content-Disposition: form-data; name="x"\r\n\r\ny'), quoted),
    ).toHaveLength(1);
  });

  it('returns null without a boundary or for a body that is not multipart', () => {
    expect(parseMultipart(Buffer.from('hi'), 'multipart/form-data')).toBeNull();
    expect(parseMultipart(Buffer.from('hi'), type)).toBeNull();
    expect(parseMultipart('not a buffer', type)).toBeNull();
  });

  it('returns null for too many parts', () => {
    const many = Array.from(
      { length: 11 },
      (_, i) => `Content-Disposition: form-data; name="p${i}"\r\n\r\nv`,
    );
    expect(parseMultipart(body(...many), type)).toBeNull();
  });
});
