// Spec 21, FIL-09: the name shown for an uploaded file. No path, no control or markup characters,
// no leading dots, at most 120 characters with the extension kept.
const MAX_LENGTH = 120;
const UNSAFE = '<>:"|?*';

const isControl = (ch) => {
  const code = ch.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

export function sanitiseFileName(raw) {
  const base =
    String(raw ?? '')
      .split(/[\\/]/)
      .pop() ?? '';
  const name = [...base]
    .map((ch) => (/\s/.test(ch) ? ' ' : ch))
    .filter((ch) => !isControl(ch) && !UNSAFE.includes(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (!name) return 'file';
  if (name.length <= MAX_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  return name.slice(0, MAX_LENGTH - ext.length) + ext;
}
