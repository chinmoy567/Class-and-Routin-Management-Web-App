// Spec 20: connects chat to the spec 09 (CR/DCR), spec 10 (join and removal) and spec 14 (rollover)
// hooks, which were left as no-ops until this module existed.
import { registerRepAssignedHook } from '../representatives/index.js';
import { registerJoinAcceptedHook, registerMembershipRemovedHook } from '../join/index.js';
import { registerRolloverHook } from '../rollover/index.js';
import {
  onAccepted,
  onMembershipRemoved,
  onRepAssigned,
  onRollover,
} from './chat.group.service.js';

registerRepAssignedHook(onRepAssigned);
registerJoinAcceptedHook(onAccepted);
registerMembershipRemovedHook(onMembershipRemoved);
registerRolloverHook(onRollover);
