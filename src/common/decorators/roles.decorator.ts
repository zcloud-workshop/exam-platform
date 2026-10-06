import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** 指定接口允许访问的角色列表, 配合 RolesGuard 使用 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
