// Spec 21: chat files. Upload (type, size, state and rate checks), the malware scan job, signed
// 5-minute download links and the download itself. Every rule runs on the server.
import crypto from 'node:crypto';
import { SOCKET_EVENTS } from '@crm/shared';
import { getConfig } from '../../config.js';
import { AppError, notFound, rateLimited } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { emitAfterCommit } from '../../lib/events.js';
import { logger } from '../../lib/logger.js';
import { scanBuffer } from '../../lib/clamav.js';
import { detectAllowedFile } from '../../lib/fileType.js';
import { sanitiseFileName } from '../../lib/fileName.js';
import { parseMultipart } from '../../lib/multipart.js';
import {
  chatFileDoc,
  deleteChatFile,
  putChatFile,
  readChatFile,
  setChatFileScan,
  streamChatFile,
} from '../../lib/gridfs.js';
import { getAgenda } from '../../lib/jobs.js';
import { can } from '../../policy/index.js';
import { Conversation, ConversationMember, Message } from './chat.model.js';
import {
  assertCanSend,
  assertChatState,
  assertUnderSendLimit,
  encryptBody,
  readable,
  viewMessage,
} from './chat.context.js';
import { fileViewsFor } from './chat.files.view.js';
import { fileCaption } from './chat.schemas.js';

export const FILE_MAX_BYTES = 5 * 1024 * 1024; // FIL-03
export const FILE_UPLOADS_PER_HOUR = 20; // FIL-10
export const FILE_SCAN_JOB = 'file.scan';
export const LINK_TTL_SECONDS = 300; // FIL-08
const HOUR_MS = 60 * 60 * 1000;

const tooLarge = () => new AppError(413, 'FILE_TOO_LARGE', 'A file can be 5 MB or smaller.');

/** FIL-01, FIL-03: read the multipart upload. Size first, then the type from the content. */
function readUpload(body, contentType) {
  const parts = Buffer.isBuffer(body) ? parseMultipart(body, contentType) : null;
  const filePart = parts?.find((p) => p.name === 'file' && p.filename !== undefined);
  if (!filePart) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Choose a file to send.');
  }
  if (filePart.data.length > FILE_MAX_BYTES) throw tooLarge();
  const captionPart = parts.find((p) => p.name === 'caption');
  const caption = fileCaption.safeParse(captionPart ? captionPart.data.toString('utf8') : '');
  if (!caption.success) {
    throw new AppError(400, 'VALIDATION_ERROR', caption.error.issues[0].message);
  }
  const mime = detectAllowedFile(filePart.data);
  if (!mime) {
    throw new AppError(
      415,
      'FILE_TYPE_NOT_ALLOWED',
      'This file type is not allowed. Use PDF, Word, PowerPoint, Excel, text or an image.',
    );
  }
  return {
    data: filePart.data,
    name: sanitiseFileName(filePart.filename),
    mime,
    caption: caption.data,
  };
}

/** FIL-10: 20 uploads per user per hour. Retry-After is when the oldest one leaves the hour. */
async function assertUnderUploadLimit(userId) {
  const since = new Date(clock.now().getTime() - HOUR_MS);
  const recent = await Message.find({
    sender_id: userId,
    file_id: { $exists: true },
    created_at: { $gte: since },
  })
    .sort({ created_at: 1 })
    .limit(FILE_UPLOADS_PER_HOUR)
    .select('created_at')
    .lean();
  if (recent.length < FILE_UPLOADS_PER_HOUR) return;
  const freesAt = new Date(recent[0].created_at).getTime() + HOUR_MS;
  throw rateLimited((freesAt - clock.now().getTime()) / 1000);
}

/**
 * FIL-04, FIL-05: store the file as pending, then create its message and queue the scan.
 * Recipients see it as "scanning" until the job finishes.
 */
export async function uploadFile(me, conversationId, body, contentType) {
  assertChatState(me);
  const { conversation, member } = await readable(me, conversationId);
  if (!can(me, 'chat.send_file', { conversation })) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot share files in this chat.');
  }
  const { other } = await assertCanSend(me, conversation, member);
  await assertUnderSendLimit(me._id);
  await assertUnderUploadLimit(me._id);
  const { data, name, mime, caption } = readUpload(body, contentType);

  const now = clock.now();
  const fileId = await putChatFile(data, {
    uploader_id: String(me._id),
    conversation_id: String(conversation._id),
    original_name: name,
    size: data.length,
    detected_type: mime,
    scan_status: 'pending',
    scanned_at: null,
  });
  let message;
  try {
    message = await Message.create({
      conversation_id: conversation._id,
      sender_id: me._id,
      body_enc: caption ? encryptBody(caption) : undefined,
      file_id: fileId,
      created_at: now,
    });
  } catch (err) {
    await deleteChatFile(fileId); // no orphan bytes without a message
    throw err;
  }
  await Conversation.updateOne({ _id: conversation._id }, { $set: { last_message_at: now } });
  await ConversationMember.updateOne({ _id: member._id }, { $set: { last_read_at: now } });
  await getAgenda().now(FILE_SCAN_JOB, {
    fileId: String(fileId),
    messageId: String(message._id),
  });

  const payload = { conversation_id: String(conversation._id), message_id: String(message._id) };
  if (other) emitAfterCommit(`user:${other.user_id}`, SOCKET_EVENTS.MESSAGE_NEW, payload);
  else emitAfterCommit(`conversation:${conversation._id}`, SOCKET_EVENTS.MESSAGE_NEW, payload);

  const raw = message.toObject();
  const files = await fileViewsFor([raw]);
  return viewMessage(raw, {
    viewerId: me._id,
    direct: conversation.type === 'direct',
    other,
    file: files.get(String(raw._id)) ?? null,
  });
}

/**
 * FIL-06: the `file.scan` job. Idempotent (FND-22): a file already decided is left alone.
 * A scanner that cannot be reached throws, so the job is retried and the file stays pending.
 */
export async function scanFile({ fileId, messageId }) {
  const doc = await chatFileDoc(fileId);
  if (!doc || doc.metadata?.scan_status !== 'pending') return;
  const message = await Message.findById(messageId).lean();
  if (!message || message.deleted_at) {
    await deleteChatFile(fileId); // the message was deleted while the file waited
    return;
  }

  const result = await scanBuffer(await readChatFile(fileId));
  if (result.infected) {
    await deleteChatFile(fileId);
    logger.warn({ fileId }, 'chat file removed after the malware scan');
    await pushFileStatus(message, 'file_removed');
    return;
  }
  await setChatFileScan(fileId, { scan_status: 'clean', scanned_at: clock.now() });
  await pushFileStatus(message, 'file_ready');
}

/** CHT-14 style push: ids and the status only. Every current member hears about it. */
async function pushFileStatus(message, status) {
  const conversation = await Conversation.findById(message.conversation_id).lean();
  if (!conversation) return;
  const payload = {
    conversation_id: String(message.conversation_id),
    message_id: String(message._id),
    status,
  };
  if (conversation.type === 'direct') {
    const members = await ConversationMember.find({
      conversation_id: conversation._id,
      removed_at: null,
    }).lean();
    for (const m of members)
      emitAfterCommit(`user:${m.user_id}`, SOCKET_EVENTS.MESSAGE_STATUS, payload);
  } else {
    emitAfterCommit(`conversation:${conversation._id}`, SOCKET_EVENTS.MESSAGE_STATUS, payload);
  }
}

/** FIL-08: the HMAC over file id, user id and expiry, keyed with FILE_LINK_KEY. */
function signLink(fileId, userId, exp) {
  return crypto
    .createHmac('sha256', getConfig().FILE_LINK_KEY)
    .update(`${fileId}:${userId}:${exp}`)
    .digest('hex');
}

/** FIL-05, FIL-07: a 5-minute link for a current member, once the file is clean. */
export async function createFileLink(me, fileId) {
  const message = await Message.findOne({ file_id: fileId, deleted_at: null }).lean();
  if (!message) throw notFound();
  await readable(me, message.conversation_id); // a removed member or a stranger gets 404
  const doc = await chatFileDoc(fileId);
  if (!doc) throw notFound(); // infected or erased
  if (doc.metadata?.scan_status !== 'clean') {
    throw new AppError(409, 'FILE_NOT_READY', 'The file is still being checked. Try again soon.');
  }
  const exp = Math.floor(clock.now().getTime() / 1000) + LINK_TTL_SECONDS;
  const sig = signLink(String(fileId), String(me._id), exp);
  const query = new URLSearchParams({ u: String(me._id), exp: String(exp), sig });
  return {
    url: `/api/chat/files/${fileId}/download?${query.toString()}`,
    expires_at: new Date(exp * 1000),
  };
}

const sameHex = (expected, given) => {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(given), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** `attachment` with an ASCII fallback and the UTF-8 name (RFC 6266). Never inline. */
function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * FIL-07, FIL-08: serve the file only to the user the link was made for, with a valid signature,
 * before it expires, and only while that user is still a member and the message is not deleted.
 */
export async function downloadFile(me, fileId, { u, exp, sig }, res) {
  if (String(me._id) !== String(u)) throw notFound();
  if (!sameHex(signLink(String(fileId), String(u), exp), sig)) throw notFound();
  if (clock.now().getTime() >= Number(exp) * 1000) {
    throw new AppError(410, 'LINK_EXPIRED', 'This link has expired. Ask for a new one.');
  }
  const message = await Message.findOne({ file_id: fileId, deleted_at: null }).lean();
  if (!message) throw notFound();
  await readable(me, message.conversation_id);
  const doc = await chatFileDoc(fileId);
  if (!doc || doc.metadata?.scan_status !== 'clean') throw notFound();

  res.set({
    'Content-Type': doc.metadata.detected_type,
    'Content-Disposition': contentDisposition(doc.metadata.original_name),
    'Content-Length': String(doc.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  await new Promise((resolve, reject) => {
    const stream = streamChatFile(fileId);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}
