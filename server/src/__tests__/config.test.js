import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { loadConfig, ConfigError } from '../config.js';

const valid = () => ({ ...process.env });

describe('config', () => {
  it('FND-04 a missing DATA_ENC_KEY is refused and named', () => {
    const env = valid();
    delete env.DATA_ENC_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/DATA_ENC_KEY/);
  });

  it('FND-04 each required variable is named when missing', () => {
    for (const name of ['MONGO_URL', 'SESSION_SECRET', 'EMAIL_HMAC_KEY', 'FILE_LINK_KEY', 'SMTP_HOST', 'MAIL_FROM', 'APP_URL', 'CLAMAV_HOST']) {
      const env = valid();
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });

  it('FND-04 DATA_ENC_KEY must be 32 bytes', () => {
    const env = { ...valid(), DATA_ENC_KEY: Buffer.from('short').toString('base64') };
    expect(() => loadConfig(env)).toThrow(/DATA_ENC_KEY/);
  });

  it('FND-04 a valid environment loads', () => {
    expect(loadConfig(valid()).APP_URL).toBe('http://localhost:5173');
  });

  it('FND-05 .env.example lists every required variable', () => {
    const text = fs.readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    for (const name of ['MONGO_URL', 'SESSION_SECRET', 'DATA_ENC_KEY', 'EMAIL_HMAC_KEY', 'FILE_LINK_KEY', 'SMTP_HOST', 'MAIL_FROM', 'APP_URL', 'CLAMAV_HOST']) {
      expect(text).toContain(`${name}=`);
    }
    const ignore = fs.readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
  });
});
