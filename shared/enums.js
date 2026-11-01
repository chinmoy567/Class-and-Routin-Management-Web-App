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

export const ADMIN_ROLES = Object.freeze(['super_admin', 'dept_admin']);

export const TOKEN_PURPOSES = Object.freeze([
  'verify_email',
  'reset_password',
  'second_step',
  'change_email',
]);

/** The screen the client shows, worked out by the server (AUTH-29). */
export const NEXT_SCREENS = Object.freeze([
  'verify-email',
  'second-step',
  'setup-totp',
  'join-form',
  'waiting-approval',
  'semester-update',
  'dashboard',
]);

/** Which states each kind of account may hold (AUTH-01). */
export const STATES_BY_KIND = Object.freeze({
  student: [
    'email_unverified',
    'claim_pending',
    'active',
    'unconfirmed',
    'graduated',
    'deactivated',
  ],
  teacher: ['email_unverified', 'pending', 'active', 'suspended', 'deactivated'],
  staff: ['active', 'deactivated'],
});

export const INSTITUTION_TIMEZONE = 'Asia/Dhaka';
export const ALLOWED_EMAIL_DOMAIN = 'baiust.ac.bd';
