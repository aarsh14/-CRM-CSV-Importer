import { Router } from 'express';
import authRoutes from './authRoutes.js';
import importRoutes from './importRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/', importRoutes); // exposes /api/import and /api/jobs/:id

export default router;
