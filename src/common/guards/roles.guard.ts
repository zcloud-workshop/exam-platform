import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * 角色守卫
 * 读取 @Roles() 装饰器声明的角色列表, 与当前用户角色匹配, 不匹配则返回 403
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 未声明 @Roles() 则放行
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return requiredRoles.includes(user.role);
  }
}
