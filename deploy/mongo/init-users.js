/* global db, print */
// OPS-03: database users and the app's role. Idempotent: safe to run again.
// Run by deploy/mongo/init-replica.sh as root (the entrypoint created it from MONGO_INITDB_ROOT_*).
// Reads the app and backup passwords from the environment; never prints them.
//
// Why a list: MongoDB cannot take one collection out of readWrite, so the app's role names each
// collection. APP_COLLECTIONS must match every collection the server touches. The test
// server/src/lib/__tests__/deploy.test.js fails when code uses one that is missing here.
// audit_log is not in the list: the app may only find, insert and create its indexes there (FND-20).

const appDb = process.env.MONGO_DB_NAME || 'crm';

const APP_COLLECTIONS = [
  'agendaJobs',
  'allowed_domain',
  'allowed_domain_guard',
  'block',
  'calendar_event',
  'captcha_challenge',
  'chat_files.chunks',
  'chat_files.files',
  'chat_suspension',
  'chat_upload_quota',
  'class_cancellation',
  'conversation',
  'conversation_member',
  'department',
  'email_batch',
  'email_dedupe',
  'enrolment',
  'flag',
  'flag_quota',
  'idem',
  'imports.chunks',
  'imports.files',
  'login_throttle',
  'message',
  'migrations',
  'one_time_token',
  'photos.chunks',
  'photos.files',
  'rate_limits',
  'reminder_log',
  'report',
  'room',
  'room_alias',
  'room_name_guard',
  'room_request',
  'room_share',
  'room_slot_lock',
  'routine_import',
  'routine_slot',
  'routine_slot_teacher',
  'section',
  'section_group',
  'semester',
  'sessions',
  'teacher',
  'teacher_registration',
  'user',
  'user_role',
  'user_role_guard',
  'uv_claim',
];

const DATA_ACTIONS = [
  'find', 'insert', 'update', 'remove', 'createIndex', 'dropIndex', 'listIndexes',
  'convertToCapped', 'createCollection', 'dropCollection', 'collStats', 'dbStats',
];
const AUDIT_ACTIONS = ['find', 'insert', 'createIndex', 'listIndexes', 'createCollection', 'collStats'];

const admin = db.getSiblingDB('admin');
const target = db.getSiblingDB(appDb);

// Collections that already exist are added too, so a new one created by hand is not missed.
const existing = target.getCollectionNames().filter((n) => n !== 'audit_log');
const names = [...new Set([...APP_COLLECTIONS, ...existing])].filter((n) => n !== 'audit_log');

const privileges = [
  ...names.map((c) => ({ resource: { db: appDb, collection: c }, actions: DATA_ACTIONS })),
  { resource: { db: appDb, collection: 'audit_log' }, actions: AUDIT_ACTIONS },
  // Creating a collection the list does not name yet (db-level, not a data action).
  { resource: { db: appDb, collection: '' }, actions: ['createCollection', 'listCollections', 'collStats', 'dbStats'] },
];
if (admin.getRole('appNoAuditMutate')) {
  admin.updateRole('appNoAuditMutate', { privileges, roles: [] });
} else {
  admin.createRole({ role: 'appNoAuditMutate', privileges, roles: [] });
}

const appRoles = [{ role: 'appNoAuditMutate', db: 'admin' }];
if (target.getUser('crm_app')) {
  target.updateUser('crm_app', { pwd: process.env.MONGO_APP_PASSWORD, roles: appRoles });
} else {
  target.createUser({ user: 'crm_app', pwd: process.env.MONGO_APP_PASSWORD, roles: appRoles });
}

// Backups: the built-in backup role only (OPS-03).
const backupRoles = [{ role: 'backup', db: 'admin' }];
if (admin.getUser('crm_backup')) {
  admin.updateUser('crm_backup', { pwd: process.env.MONGO_BACKUP_PASSWORD, roles: backupRoles });
} else {
  admin.createUser({ user: 'crm_backup', pwd: process.env.MONGO_BACKUP_PASSWORD, roles: backupRoles });
}

print('users ready: app role covers ' + names.length + ' collections; audit_log is find, insert and index only');
