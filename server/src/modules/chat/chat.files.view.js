// Spec 21: the public shape of a message's file. Name, size and type come from the GridFS record;
// status is `scanning` (pending), `ready` (clean) or `removed` (no record: infected or erased).
import { chatFileDocsByIds } from '../../lib/gridfs.js';

/** Map of message id → file view, for the messages that have a file and are not deleted. */
export async function fileViewsFor(messages) {
  const live = messages.filter((m) => m.file_id && !m.deleted_at);
  const docs = await chatFileDocsByIds(live.map((m) => m.file_id));
  const byFile = new Map(docs.map((d) => [String(d._id), d]));
  const views = new Map();
  for (const m of live) {
    const id = String(m.file_id);
    const doc = byFile.get(id);
    views.set(
      String(m._id),
      doc ? viewOf(id, doc) : { id, name: null, size: null, type: null, status: 'removed' },
    );
  }
  return views;
}

function viewOf(id, doc) {
  return {
    id,
    name: doc.metadata?.original_name ?? null,
    size: doc.length ?? null,
    type: doc.metadata?.detected_type ?? null,
    status: doc.metadata?.scan_status === 'clean' ? 'ready' : 'scanning',
  };
}
