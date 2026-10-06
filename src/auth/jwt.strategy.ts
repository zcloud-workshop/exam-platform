import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-request';

/** JWT payload 结构 */
interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
}

/**
 * Passport JWT 策略
 * 从 Authorization: Bearer <token> 中提取并验证 JWT
 * validate() 返回值会挂载到 req.user
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => extractCookieToken(request),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  /** 将 JWT payload 映射为 req.user 对象 */
  validate(payload: JwtPayload): AuthenticatedUser {
    return { id: payload.sub, username: payload.username, role: payload.role };
  }
}

function extractCookieToken(request: Request): string | null {
  const cookie = request.headers.cookie;
  if (!cookie) return null;
  const token = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('exam_token='));
  return token ? decodeURIComponent(token.slice('exam_token='.length)) : null;
}
