import { Router } from 'express';
import { requireAuth } from '../auth/index.js';
import { myRoutineHandler } from './my-routine.controller.js';

export const myRoutineRouter = Router();

myRoutineRouter.get('/me/routine', requireAuth, myRoutineHandler);
