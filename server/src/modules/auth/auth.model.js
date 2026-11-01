import mongoose from 'mongoose';
import { ACCOUNT_STATES, ROLES, USER_KINDS } from '@crm/shared/enums';

const { Schema } = mongoose;

// Minimal shape needed by the foundation (seed, request user, test factories).
// Spec 01 and later extend it.
const userSchema = new Schema(
  {
    kind: { type: String, enum: USER_KINDS, required: true },
    state: { type: String, enum: ACCOUNT_STATES, required: true },
    name: { type: String, required: true },
    email_enc: { type: String, select: false },
    email_hmac: { type: String, required: true },
    phone_enc: { type: String, select: false },
    password_hash: { type: String, select: false },
    email_verified_at: { type: Date },
    reset_token_hash: { type: String, select: false },
    reset_token_expires: { type: Date, select: false },
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

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
export const UserRole = mongoose.models.UserRole ?? mongoose.model('UserRole', userRoleSchema);
