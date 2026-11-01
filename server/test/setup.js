import crypto from 'node:crypto';

// Safe, fixed configuration for every test file.
process.env.NODE_ENV = 'test';
process.env.MONGO_URL ??= process.env.TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/test';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
process.env.DATA_ENC_KEY = crypto.createHash('sha256').update('test-enc-key').digest('base64');
process.env.EMAIL_HMAC_KEY = 'test-email-hmac-key';
process.env.FILE_LINK_KEY = 'test-file-link-key';
process.env.SMTP_HOST = 'localhost';
process.env.MAIL_FROM = 'no-reply@baiust.ac.bd';
process.env.APP_URL = 'http://localhost:5173';
process.env.CLAMAV_HOST = 'localhost';
process.env.LOG_LEVEL = 'silent';
