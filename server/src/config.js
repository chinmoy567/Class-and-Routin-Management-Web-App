import { z } from 'zod';

const base64Key32 = z
  .string({ error: 'is required' })
  .min(1, 'is required')
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const nonEmpty = z.string({ error: 'is required' }).min(1, 'is required');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URL: nonEmpty,
  SESSION_SECRET: z.string({ error: 'is required' }).min(16, 'must be at least 16 characters'),
  DATA_ENC_KEY: base64Key32,
  EMAIL_HMAC_KEY: nonEmpty,
  FILE_LINK_KEY: nonEmpty,
  SMTP_HOST: nonEmpty,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: nonEmpty,
  APP_URL: z.string().url(),
  CLAMAV_HOST: nonEmpty,
  // Optional: comma-separated DNS servers for mongodb+srv lookups when the OS resolver can't do SRV
  DNS_SERVERS: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
});

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`);
    throw new ConfigError(problems);
  }
  return Object.freeze(result.data);
}

let cached;
export function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}
export function resetConfigForTests() {
  cached = undefined;
}
