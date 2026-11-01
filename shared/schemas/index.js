import { z } from 'zod';

export const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export * from './auth.js';
