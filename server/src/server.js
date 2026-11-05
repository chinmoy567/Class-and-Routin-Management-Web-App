import http from 'node:http';
import { getConfig, ConfigError } from './config.js';
import { logger } from './lib/logger.js';
import { connectDb, syncAllIndexes } from './lib/db.js';
import { getAgenda, startJobs } from './lib/jobs.js';
import { initSocket } from './lib/socket.js';
import { MongoRateLimitStore } from './lib/rateLimitStore.js';
import { createApp, createSessionMiddleware } from './app.js';
import { defineMailJobs, DIGEST_JOB } from './modules/notifications/index.js';
import {
  COVERAGE_JOB,
  defineAdminRoleJobs,
  defineAuthJobs,
  ensureSessionIndex,
} from './modules/auth/index.js';
import { defineJoinJobs, ESCALATE_JOB } from './modules/join/index.js';
import { defineBookingJobs, EXPIRE_JOB } from './modules/bookings/index.js';
import { defineRolloverJobs, REMINDER_JOB } from './modules/rollover/index.js';
import { ensureChatFileIndex, ensurePhotoIndex } from './lib/gridfs.js';
import {
  defineChatFileJobs,
  defineChatRetentionJobs,
  RETENTION_JOB,
} from './modules/chat/index.js';

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
  await ensureChatFileIndex();
  await startJobs({
    url: config.MONGO_URL,
    registrars: [
      defineMailJobs,
      defineAuthJobs,
      defineAdminRoleJobs,
      defineJoinJobs,
      defineBookingJobs,
      defineRolloverJobs,
      defineChatFileJobs,
      defineChatRetentionJobs,
    ],
  });
  // DEP-12: the hourly safety net; role changes also run the check straight away.
  await getAgenda().every('1 hour', COVERAGE_JOB, {}, { timezone: 'UTC' });

  // JR-14: requests nobody decided for 72 hours move to the admin.
  await getAgenda().every('15 minutes', ESCALATE_JOB, {}, { timezone: 'UTC' });

  // BKG-17: pending room requests with no decision 2 hours before the start expire.
  await getAgenda().every('5 minutes', EXPIRE_JOB, {}, { timezone: 'UTC' });

  // ROL-13: the semester update reminders, every day at 09:00 Dhaka time.
  await getAgenda().every('0 9 * * *', REMINDER_JOB, {}, { timezone: 'Asia/Dhaka' });

  // EML-08: the admin digest, at 08:00 and 17:00 Dhaka time.
  await getAgenda().every('0 8,17 * * *', DIGEST_JOB, {}, { timezone: 'Asia/Dhaka' });

  // SAF-12: the chat retention job, every night at 02:00 Dhaka time.
  await getAgenda().every('0 2 * * *', RETENTION_JOB, {}, { timezone: 'Asia/Dhaka' });

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
