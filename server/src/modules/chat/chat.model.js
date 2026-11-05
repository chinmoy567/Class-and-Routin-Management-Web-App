import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (extra = {}) => ({ type: Schema.Types.ObjectId, ...extra });

// Spec 20: one conversation per pair of people (direct) or one per section and semester (group).
const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct', 'section_group'], required: true },
    pair_key: { type: String },
    section_id: oid(),
    semester_id: oid(),
    name: { type: String },
    closed_at: { type: Date, default: null },
    last_message_at: { type: Date },
  },
  { collection: 'conversation', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
// CHT-05: one direct conversation per pair of users.
conversationSchema.index(
  { pair_key: 1 },
  { unique: true, partialFilterExpression: { type: 'direct' } },
);
// CHT-08: one group per section per semester.
conversationSchema.index(
  { section_id: 1, semester_id: 1 },
  { unique: true, partialFilterExpression: { type: 'section_group' } },
);

const memberSchema = new Schema(
  {
    conversation_id: oid({ required: true }),
    user_id: oid({ required: true }),
    role: { type: String, enum: ['member', 'owner'], default: 'member' },
    removed_at: { type: Date, default: null },
    removed_by: oid(),
    // CHT-10a: one appeal per removal.
    appeal_text: { type: String },
    appealed_at: { type: Date, default: null },
    last_read_at: { type: Date, default: null },
    last_delivered_at: { type: Date, default: null },
  },
  { collection: 'conversation_member', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
memberSchema.index({ conversation_id: 1, user_id: 1 }, { unique: true });
memberSchema.index({ user_id: 1, conversation_id: 1 });

// CHT-06, CHT-18: the body is encrypted at rest (body_enc). Deleted messages keep no body.
const messageSchema = new Schema(
  {
    conversation_id: oid({ required: true }),
    sender_id: oid({ required: true }),
    body_enc: { type: String },
    // Spec 21: the attached file (GridFS chat_files). Its name, size and scan state live there.
    file_id: oid(),
    deleted_at: { type: Date, default: null },
    deleted_by: oid(),
    created_at: { type: Date, required: true },
  },
  { collection: 'message' },
);
messageSchema.index({ conversation_id: 1, created_at: -1 });
// FIL-08: a link is checked by file id; FIL-10: uploads per user per hour.
messageSchema.index({ file_id: 1 }, { sparse: true });
messageSchema.index({ sender_id: 1, file_id: 1, created_at: -1 });
// CHT, rate limit: sends per user per minute.
messageSchema.index({ sender_id: 1, created_at: -1 });

export const Conversation =
  mongoose.models.Conversation ?? mongoose.model('Conversation', conversationSchema);
export const ConversationMember =
  mongoose.models.ConversationMember ?? mongoose.model('ConversationMember', memberSchema);
export const Message = mongoose.models.Message ?? mongoose.model('Message', messageSchema);
