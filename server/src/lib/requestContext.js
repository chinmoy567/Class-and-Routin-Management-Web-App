import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage();
export const currentRequestId = () => requestContext.getStore()?.requestId;
