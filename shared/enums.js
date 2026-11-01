export const USER_KINDS = Object.freeze(['student', 'teacher', 'staff']);

export const ACCOUNT_STATES = Object.freeze([
  'email_unverified',
  'claim_pending',
  'active',
  'unconfirmed',
  'graduated',
  'deactivated',
  'pending',
  'suspended',
]);

export const ROLES = Object.freeze(['super_admin', 'dept_admin', 'teacher', 'cr', 'dcr']);

export const SOCKET_EVENTS = Object.freeze({
  ROUTINE_CHANGED: 'routine.changed',
  BOOKING_CHANGED: 'booking.changed',
  CALENDAR_CHANGED: 'calendar.changed',
  MESSAGE_NEW: 'message.new',
  MESSAGE_STATUS: 'message.status',
});

export const INSTITUTION_TIMEZONE = 'Asia/Dhaka';
export const ALLOWED_EMAIL_DOMAIN = 'baiust.ac.bd';
