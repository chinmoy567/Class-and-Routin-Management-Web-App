import mongoose from 'mongoose';
import { ROOM_REQUEST_STATUSES } from '@crm/shared';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// Spec 19. One request for one room, one date and one time range. Requester is a section
// (requester_section_id) or a teacher (requester_teacher_id).
const roomRequestSchema = new Schema(
  {
    semester_id: oid({ required: true }),
    requester_section_id: oid(),
    requester_teacher_id: oid(),
    sent_by_user_id: oid({ required: true }),
    target_section_id: oid({ required: true }),
    target_group_id: oid(),
    named_teacher_id: oid(),
    room_id: oid({ required: true }),
    date: { type: String, required: true }, // YYYY-MM-DD, institution time
    start_min: { type: Number, required: true },
    end_min: { type: Number, required: true },
    starts_at: { type: Date, required: true }, // UTC instant of the start, for the expiry job
    note: { type: String, required: true },
    status: { type: String, enum: ROOM_REQUEST_STATUSES, required: true },
    reason: { type: String },
    decided_by: oid(),
    decided_at: { type: Date },
    cancelled_by: oid(),
    cancelled_at: { type: Date },
    late_cancel: { type: Boolean, default: false },
    no_show_note: { type: String },
    version: { type: Number, default: 0 },
  },
  { collection: 'room_request', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
roomRequestSchema.index({ room_id: 1, date: 1, status: 1 });
roomRequestSchema.index({ requester_section_id: 1, date: 1, status: 1 });
roomRequestSchema.index({ requester_teacher_id: 1, date: 1, status: 1 });
roomRequestSchema.index({ target_section_id: 1, date: 1, status: 1 });
roomRequestSchema.index({ status: 1, starts_at: 1 }); // expiry job (BKG-17)

// BKG-13. A room is locked for each 5-minute block of an approved booking. A second approval for
// the same block fails with a duplicate-key error inside the approval transaction.
const roomSlotLockSchema = new Schema(
  {
    room_id: oid({ required: true }),
    date: { type: String, required: true },
    block_start: { type: Number, required: true },
    room_request_id: oid({ required: true }),
  },
  { collection: 'room_slot_lock', versionKey: false },
);
roomSlotLockSchema.index({ room_id: 1, date: 1, block_start: 1 }, { unique: true });
roomSlotLockSchema.index({ room_request_id: 1 });

const model = (name, schema) => mongoose.models[name] ?? mongoose.model(name, schema);
export const RoomRequest = model('RoomRequest', roomRequestSchema);
export const RoomSlotLock = model('RoomSlotLock', roomSlotLockSchema);
