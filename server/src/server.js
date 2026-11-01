import http from 'node:http';
import { getConfig, ConfigError } from './config.js';
import { logger } from './lib/logger.js';
import { connectDb, syncAllIndexes } from './lib/db.js';
import { getAgenda, startJobs } from './lib/jobs.js';
import { initSocket } from './lib/socket.js';
import { MongoRateLimitStore } from './lib/rateLimitStore.js';
import { createApp, createSessionMiddleware } from './app.js';
import { defineMailJobs } from './modules/notifications/index.js';
import {
  COVERAGE_JOB,
  defineAdminRoleJobs,
  defineAuthJobs,
  ensureSessionIndex,
} from './modules/auth/index.js';
import { ensurePhotoIndex } from './lib/gridfs.js';

async function main() {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  try {
    await connectDb(config.MONGO_URL, { dnsServers: config.DNS_SERVERS });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (config.NODE_ENV !== 'production') await syncAllIndexes();
  await new MongoRateLimitStore().ensureIndexes();
  await ensureSessionIndex();
  await ensurePhotoIndex();
  await startJobs({
    url: config.MONGO_URL,
    registrars: [defineMailJobs, defineAuthJobs, defineAdminRoleJobs],
  });
  // DEP-12: the hourly safety net; role changes also run the check straight away.
  await getAgenda().every('1 hour', COVERAGE_JOB, {}, { timezone: 'UTC' });

  const sessionMiddleware = createSessionMiddleware(config);
  const app = createApp(config, { sessionMiddleware });
  const server = http.createServer(app);
  initSocket(server, sessionMiddleware);
  server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'server listening'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
