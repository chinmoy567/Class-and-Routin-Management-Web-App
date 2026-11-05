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
    // SAF-09: held while a report is open (hold_open), then until hold_until.
    hold_open: { type: Boolean, default: false },
    hold_until: { type: Date, default: null },
  },
  { collection: 'message' },
);
// Spec 22 retention jobs (SAF-12 to SAF-14).
messageSchema.index({ created_at: 1 });
messageSchema.index({ deleted_at: 1 }, { sparse: true });
messageSchema.index({ hold_until: 1 }, { sparse: true });
messageSchema.index({ conversation_id: 1, created_at: -1 });
// FIL-08: a link is checked by file id; FIL-10: uploads per user per hour.
messageSchema.index({ file_id: 1 }, { sparse: true });
messageSchema.index({ sender_id: 1, file_id: 1, created_at: -1 });
// CHT, rate limit: sends per user per minute.
messageSchema.index({ sender_id: 1, created_at: -1 });

// SAF-01: a one-way block. `blocker_id` can't be messaged by `blocked_id` one-to-one.
const blockSchema = new Schema(
  {
    blocker_id: oid({ required: true }),
    blocked_id: oid({ required: true }),
    created_at: { type: Date, required: true },
  },
  { collection: 'block' },
);
blockSchema.index({ blocker_id: 1, blocked_id: 1 }, { unique: true });
blockSchema.index({ blocked_id: 1 });

// SAF-04, SAF-05, SAF-08: a report of a message or a person, routed when created.
const reportSchema = new Schema(
  {
    reporter_id: oid({ required: true }),
    target_user_id: oid({ required: true }),
    message_id: oid(),
    conversation_id: oid(),
    category: {
      type: String,
      enum: ['harassment', 'spam', 'inappropriate', 'impersonation', 'other'],
      required: true,
    },
    note: { type: String },
    department_id: oid(),
    to_super_admins: { type: Boolean, default: false },
    // SAF-09: the reported message and up to 5 either side, fixed when the report is made.
    window_ids: [oid()],
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    outcome: { type: String, enum: ['no_action', 'warned', 'suspended', 'message_removed'] },
    outcome_note: { type: String },
    closed_by: oid(),
    closed_at: { type: Date, default: null },
    hold_until: { type: Date, default: null },
    created_at: { type: Date, required: true },
  },
  { collection: 'report' },
);
reportSchema.index({ status: 1, department_id: 1, created_at: -1 });
reportSchema.index({ reporter_id: 1, created_at: -1 });
reportSchema.index({ message_id: 1 }, { sparse: true });

// SAF-10: a timed suspension from sending. `user.chat_suspended_until` mirrors the latest one.
const suspensionSchema = new Schema(
  {
    user_id: oid({ required: true }),
    until: { type: Date, required: true },
    reason: { type: String, required: true },
    by: oid({ required: true }),
    created_at: { type: Date, required: true },
    lifted_at: { type: Date, default: null },
    lifted_by: oid(),
  },
  { collection: 'chat_suspension' },
);
suspensionSchema.index({ user_id: 1, until: -1 });

export const Block = mongoose.models.Block ?? mongoose.model('Block', blockSchema);
export const Report = mongoose.models.Report ?? mongoose.model('Report', reportSchema);
export const ChatSuspension =
  mongoose.models.ChatSuspension ?? mongoose.model('ChatSuspension', suspensionSchema);

export const Conversation =
  mongoose.models.Conversation ?? mongoose.model('Conversation', conversationSchema);
export const ConversationMember =
  mongoose.models.ConversationMember ?? mongoose.model('ConversationMember', memberSchema);
export const Message = mongoose.models.Message ?? mongoose.model('Message', messageSchema);
