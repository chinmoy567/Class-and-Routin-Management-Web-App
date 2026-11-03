// DSH-10, DSH-16: yes/no facts about a user's contact details. The address and number never leave here.
import { User } from './auth.model.js';

/** @returns {{ email_verified, email_bouncing, has_phone, has_photo } | null} */
export async function contactStatus(userId) {
  const u = await User.findById(userId)
    .select('+phone_enc email_verified_at email_bouncing photo_file_id')
    .lean();
  if (!u) return null;
  return {
    email_verified: Boolean(u.email_verified_at),
    email_bouncing: Boolean(u.email_bouncing),
    has_phone: Boolean(u.phone_enc),
    has_photo: Boolean(u.photo_file_id),
  };
}
