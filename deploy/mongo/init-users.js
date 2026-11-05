/* global db, print */
// OPS-03 users and roles. Idempotent: safe to run again (for example after a new collection is added).
// Run through deploy/mongo/init-replica.sh. Reads passwords from the environment; never prints them.
const appDb = process.env.MONGO_DB_NAME || 'crm';
const admin = db.getSiblingDB('admin');
// Root is the admin user for maintenance. Created only if missing.
if (!admin.getUser('root')) {
  admin.createUser({
    user: 'root',
    pwd: process.env.MONGO_ROOT_PASSWORD,
    roles: [{ role: 'root', db: 'admin' }],
  });
}

// The app writes its data, except audit_log, where it may only read and insert (FND-20).
// Mongo cannot subtract a collection from readWrite, so the role lists every collection that
// exists now. Re-run this script after a new collection is created to extend the list.
const target = db.getSiblingDB(appDb);
const names = target.getCollectionNames().filter((n) => n !== 'audit_log');
const dataActions = [
  'find', 'insert', 'update', 'remove', 'createIndex', 'dropIndex', 'listIndexes',
  'convertToCapped', 'createCollection', 'dropCollection', 'collStats', 'dbStats',
];
const privileges = names.map((c) => ({ resource: { db: appDb, collection: c }, actions: dataActions }));
privileges.push({ resource: { db: appDb, collection: 'audit_log' }, actions: ['find', 'insert', 'createIndex', 'listIndexes', 'collStats'] });
privileges.push({ resource: { db: appDb, collection: 'audit_log' }, actions: ['createCollection'] });
privileges.push({ resource: { db: appDb, collection: '' }, actions: ['createCollection', 'listCollections', 'collStats', 'dbStats'] });
privileges.push({ resource: { db: appDb, collection: 'migrations' }, actions: ['find', 'insert', 'update', 'remove', 'createIndex', 'listIndexes'] });
privileges.push({ resource: { db: appDb, collection: 'fs.files' }, actions: dataActions });
privileges.push({ resource: { db: appDb, collection: 'fs.chunks' }, actions: dataActions });
if (!admin.getRole('appNoAuditMutate')) {
  admin.createRole({ role: 'appNoAuditMutate', privileges, roles: [] });
} else {
  admin.updateRole('appNoAuditMutate', { privileges, roles: [] });
}

const appUser = target.getUser('crm_app');
const appRoles = [{ role: 'appNoAuditMutate', db: 'admin' }];
if (appUser) {
  target.updateUser('crm_app', { pwd: process.env.MONGO_APP_PASSWORD, roles: appRoles });
} else {
  target.createUser({ user: 'crm_app', pwd: process.env.MONGO_APP_PASSWORD, roles: appRoles });
}

// Backups: backup rights only (OPS-03).
const backupRoles = [{ role: 'backup', db: 'admin' }];
if (admin.getUser('crm_backup')) {
  admin.updateUser('crm_backup', { pwd: process.env.MONGO_BACKUP_PASSWORD, roles: backupRoles });
} else {
  admin.createUser({ user: 'crm_backup', pwd: process.env.MONGO_BACKUP_PASSWORD, roles: backupRoles });
}
print(`users ready; app role covers ${names.length} collections except audit_log`);
