import { io } from 'socket.io-client';

let socket = null;

/** Connect once, after sign-in. Push events only say "refetch"; they carry no data. */
export function connectSocket() {
  if (!socket) socket = io({ withCredentials: true, autoConnect: true });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe to an event; returns the unsubscribe function. */
export function onEvent(event, handler) {
  const s = connectSocket();
  s.on(event, handler);
  return () => s.off(event, handler);
}
