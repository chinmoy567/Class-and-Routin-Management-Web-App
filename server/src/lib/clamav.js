import net from 'node:net';
import { getConfig } from '../config.js';

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 30_000;

/**
 * Scan a buffer with clamd over its INSTREAM protocol (node:net only, no library).
 * Resolves `{ infected, signature }`. Rejects when clamd can't be reached or answers with an
 * error, so the caller can retry later instead of treating the file as clean.
 */
function clamdScan(buffer) {
  const config = getConfig();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT });
    const answer = [];
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('clamd timed out')));
    socket.on('error', reject);
    socket.on('data', (d) => answer.push(d));
    socket.on('close', () => {
      const text = Buffer.concat(answer).toString('utf8').replace(/\0/g, '').trim();
      if (/OK$/.test(text)) return resolve({ infected: false });
      const found = text.match(/^stream:\s*(.+)\s+FOUND$/);
      if (found) return resolve({ infected: true, signature: found[1] });
      reject(new Error('clamd gave an unexpected answer'));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const part = buffer.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero length ends the stream
    });
  });
}

let scanner = clamdScan;

/** Tests inject a fake scanner here; call with no argument to restore ClamAV. */
export function setScanner(fn) {
  scanner = fn ?? clamdScan;
}

export const scanBuffer = (buffer) => scanner(buffer);
