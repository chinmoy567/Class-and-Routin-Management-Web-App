import { registerPolicies } from '../../policy/index.js';
import { roomsPolicy } from './rooms.policy.js';
import { registerDepartmentUsage } from '../organisation/index.js';
import { departmentHasRooms } from './rooms.service.js';

registerPolicies(roomsPolicy);

// DEP-02: a department that owns a room can no longer change its code.
registerDepartmentUsage({ codeLocked: departmentHasRooms });

export { roomsRouter, roomsAdminRouter } from './rooms.routes.js';
export { resolve, registerRoomUsage, resetRoomUsage } from './rooms.service.js';
export { normaliseName } from './normalise.js';
export { Room, RoomAlias, RoomShare } from './rooms.model.js';
