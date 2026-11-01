import mongoose from 'mongoose';
import { ROOM_TYPES } from '@crm/shared';

const { Schema } = mongoose;

// ROOM-01, ROOM-06. A retired room stays, so old routines and bookings keep pointing at it, and
// its code stays reserved.
const roomSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    code_norm: { type: String, required: true },
    type: { type: String, enum: ROOM_TYPES, required: true },
    owner_department_id: { type: Schema.Types.ObjectId, required: true },
    retired: { type: Boolean, default: false },
    retired_at: { type: Date },
  },
  { collection: 'room', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
roomSchema.index({ code_norm: 1 }, { unique: true });
roomSchema.index({ owner_department_id: 1, retired: 1 });

// ROOM-02. The alias is also unique against room codes, which no single index can say, so the
// service checks both collections inside one transaction (see RoomNameGuard).
const roomAliasSchema = new Schema(
  {
    alias: { type: String, required: true, trim: true },
    alias_norm: { type: String, required: true },
    room_id: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'room_alias', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
roomAliasSchema.index({ alias_norm: 1 }, { unique: true });
roomAliasSchema.index({ room_id: 1 });

// ROOM-04
const roomShareSchema = new Schema(
  {
    room_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'room_share', versionKey: false },
);
roomShareSchema.index({ room_id: 1, department_id: 1 }, { unique: true });
roomShareSchema.index({ department_id: 1 });

// One document. Every change to a code or an alias writes to it first inside its transaction, so
// two changes at once conflict and run one after the other (mongo-patterns §6). That is what
// keeps "a name is either a code or an alias, never both" true under concurrency.
const roomNameGuardSchema = new Schema(
  { _id: { type: String }, version: { type: Number, default: 0 } },
  { collection: 'room_name_guard', versionKey: false },
);

export const Room = mongoose.models.Room ?? mongoose.model('Room', roomSchema);
export const RoomAlias = mongoose.models.RoomAlias ?? mongoose.model('RoomAlias', roomAliasSchema);
export const RoomShare = mongoose.models.RoomShare ?? mongoose.model('RoomShare', roomShareSchema);
export const RoomNameGuard =
  mongoose.models.RoomNameGuard ?? mongoose.model('RoomNameGuard', roomNameGuardSchema);
