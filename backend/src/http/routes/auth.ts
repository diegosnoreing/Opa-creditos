import { Router, type RequestHandler } from 'express';
import type { AuthService } from '../../services/authService';
import { validarBody } from '../middlewares/validate';
import { loginSchema } from '../schemas';

export function authRouter(auth: AuthService, limitadorLogin: RequestHandler): Router {
  const router = Router();

  router.post('/login', limitadorLogin, validarBody(loginSchema), async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    res.json({ success: true, data: await auth.login(username, password) });
  });

  return router;
}
