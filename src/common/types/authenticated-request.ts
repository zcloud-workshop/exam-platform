import type { User } from '@prisma/client';
import type { Request } from 'express';

export type AuthenticatedUser = Pick<User, 'id' | 'username' | 'role'>;

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
