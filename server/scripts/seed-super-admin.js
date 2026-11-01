import { parseArgs } from 'node:util';
import { getConfig } from '../src/config.js';
import { connectDb, disconnectDb, syncAllIndexes } from '../src/lib/db.js';
import { seedSuperAdmin } from '../src/modules/auth/index.js';
import '../src/modules/organisation/organisation.model.js';
import '../src/modules/audit/audit.model.js';

/** FND-36: npm run seed:super-admin -- --email <e> --name <n> */
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });

if (!values.email || !values.name) {
  console.error('Usage: npm run seed:super-admin -- --email <email> --name <name>');
  process.exit(1);
}

const config = getConfig();
await connectDb(config.MONGO_URL, { dnsServers: config.DNS_SERVERS });
await syncAllIndexes();
try {
  const { resetLink } = await seedSuperAdmin({
    email: values.email,
    name: values.name,
    appUrl: config.APP_URL,
  });
  console.log('Super admin created. Set the password with this one-time link (valid 24 hours):');
  console.log(resetLink);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
