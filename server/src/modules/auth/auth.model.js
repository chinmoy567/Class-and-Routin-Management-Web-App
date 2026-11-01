import mongoose from 'mongoose';
import {
  ACCOUNT_STATES,
  ROLES,
  STATES_BY_KIND,
  TOKEN_PURPOSES,
  USER_KINDS,
} from '@crm/shared/enums';

const { Schema } = mongoose;

// AUTH-01, AUTH-03. email_enc, phone_enc, password_hash and totp_secret_enc are never selected by default.
const userSchema = new Schema(
  {
    kind: { type: String, enum: USER_KINDS, required: true },
    state: {
      type: String,
      enum: ACCOUNT_STATES,
      required: true,
      validate: {
        validator(value) {
          return !this.kind || STATES_BY_KIND[this.kind]?.includes(value);
        },
        message: 'State is not allowed for this kind of account.',
      },
    },
    full_name: { type: String, required: true },
    email_enc: { type: String, select: false },
    email_hmac: { type: String, required: true },
    email_verified_at: { type: Date },
    email_bouncing: { type: Boolean, default: false },
    phone_enc: { type: String, select: false },
    photo_file_id: { type: Schema.Types.ObjectId },
    password_hash: { type: String, select: false },
    password_changed_at: { type: Date },
    totp_secret_enc: { type: String, select: false },
    totp_enabled_at: { type: Date },
    department_id: { type: Schema.Types.ObjectId },
    requested_short_code: { type: String },
    chat_suspended_until: { type: Date },
  },
  { collection: 'user', timestamps: true },
);
userSchema.index({ email_hmac: 1 }, { unique: true });

const userRoleSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    department_id: { type: Schema.Types.ObjectId },
    section_id: { type: Schema.Types.ObjectId },
    semester_id: { type: Schema.Types.ObjectId },
  },
  { collection: 'user_role' },
);
userRoleSchema.index({ user_id: 1 });

// Links and codes that work once. TTL removal is lazy, so expires_at is always checked in queries.
const oneTimeTokenSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: TOKEN_PURPOSES, required: true },
    token_hash: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    expires_at: { type: Date, required: true },
    used_at: { type: Date },
  },
  { collection: 'one_time_token', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
oneTimeTokenSchema.index({ token_hash: 1 }, { unique: true });
oneTimeTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
oneTimeTokenSchema.index({ user_id: 1, purpose: 1 });

// AUTH-14, AUTH-15: failed sign-in counters, one document per account key or IP key.
const loginThrottleSchema = new Schema(
  {
    key: { type: String, required: true },
    fails: { type: Number, default: 0 },
    first_fail_at: { type: Date },
    next_allowed_at: { type: Date },
    hour_fails: { type: Number, default: 0 },
    hour_started_at: { type: Date },
    notified_at: { type: Date },
    updated_at: { type: Date },
  },
  { collection: 'login_throttle', versionKey: false },
);
loginThrottleSchema.index({ key: 1 }, { unique: true });
loginThrottleSchema.index({ updated_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

// Self-hosted CAPTCHA: a proof-of-work challenge that can be used once.
const captchaChallengeSchema = new Schema(
  {
    prefix: { type: String, required: true },
    bits: { type: Number, required: true },
    expires_at: { type: Date, required: true },
    used_at: { type: Date },
  },
  { collection: 'captcha_challenge', versionKey: false },
);
captchaChallengeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
export const UserRole = mongoose.models.UserRole ?? mongoose.model('UserRole', userRoleSchema);
export const OneTimeToken =
  mongoose.models.OneTimeToken ?? mongoose.model('OneTimeToken', oneTimeTokenSchema);
export const LoginThrottle =
  mongoose.models.LoginThrottle ?? mongoose.model('LoginThrottle', loginThrottleSchema);
export const CaptchaChallenge =
  mongoose.models.CaptchaChallenge ?? mongoose.model('CaptchaChallenge', captchaChallengeSchema);
