import { Server } from 'socket.io';
import { setEmitter } from './events.js';
import { logger } from './logger.js';

let io = null;
const connectHooks = [];

/**
 * Feature modules register a function that runs for each new socket (after it joined its own
 * rooms). Spec 20 uses it to join the conversation rooms the user may read.
 */
export function onSocketConnect(fn) {
  connectHooks.push(fn);
}

/** Spec 20 (CHT-20): the server moves a user's sockets into or out of a room. Clients never can. */
export async function joinUserRoom(userId, room) {
  if (io) io.in(`user:${userId}`).socketsJoin(room);
}
export async function leaveUserRoom(userId, room) {
  if (io) io.in(`user:${userId}`).socketsLeave(room);
}

/**
 * FND-25: Socket.IO shares the Express session. Unauthenticated sockets are rejected.
 * Each socket joins `user:<id>`; feature specs add more rooms.
 */
export function initSocket(httpServer, sessionMiddleware, { onConnect } = {}) {
  io = new Server(httpServer, { serveClient: false });
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (!userId) return next(new Error('UNAUTHENTICATED'));
    socket.data.userId = String(userId);
    next();
  });
  io.on('connection', async (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socket.join('everyone'); // calendar.changed and other university-wide pushes
    // A failing hook must not become an unhandled rejection (it would take the server down).
    for (const fn of connectHooks) {
      try {
        await fn(socket);
      } catch (err) {
        logger.error({ err }, 'socket connect hook failed');
      }
    }
    if (onConnect) await onConnect(socket);
  });
  setEmitter((room, event, payload) => io.to(room).emit(event, payload));
  return io;
}
