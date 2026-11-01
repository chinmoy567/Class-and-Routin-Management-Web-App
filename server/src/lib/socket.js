import { Server } from 'socket.io';
import { setEmitter } from './events.js';

/**
 * FND-25: Socket.IO shares the Express session. Unauthenticated sockets are rejected.
 * Each socket joins `user:<id>`; feature specs add more rooms.
 */
export function initSocket(httpServer, sessionMiddleware, { onConnect } = {}) {
  const io = new Server(httpServer, { serveClient: false });
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (!userId) return next(new Error('UNAUTHENTICATED'));
    socket.data.userId = String(userId);
    next();
  });
  io.on('connection', async (socket) => {
    socket.join(`user:${socket.data.userId}`);
    if (onConnect) await onConnect(socket);
  });
  setEmitter((room, event, payload) => io.to(room).emit(event, payload));
  return io;
}
