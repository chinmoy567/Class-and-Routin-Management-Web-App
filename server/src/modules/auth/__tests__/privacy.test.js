import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.join(here, '..');
const sources = fs
  .readdirSync(authDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, fs.readFileSync(path.join(authDir, f), 'utf8')]);

describe('privacy in the auth module', () => {
  it('AUTH-03 AUTH-29 the auth code never logs: no logger or console call can leak an email, password, token or code', () => {
    // FND-30 redacts known fields and request logs never include bodies. On top of that, the
    // auth module writes no log lines of its own.
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/\blogger\./);
      expect(text, file).not.toMatch(/\bconsole\./);
    }
  });

  it('AUTH-03 the sensitive user fields are not selected by default', async () => {
    const { User } = await import('../auth.model.js');
    for (const field of ['email_enc', 'phone_enc', 'password_hash', 'totp_secret_enc']) {
      expect(User.schema.path(field).options.select, field).toBe(false);
    }
  });

  it('AUTH-03 no controller sends a Mongoose document or the stored email fields', () => {
    const controller = sources.find(([f]) => f === 'auth.controller.js')[1];
    expect(controller).not.toMatch(/email_enc|email_hmac|password_hash|phone_enc/);
  });
});
