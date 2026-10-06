import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/** 认证服务, 处理用户身份校验和 JWT 签发 */
@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * 校验用户名和密码
   * @returns 成功返回脱敏用户信息, 失败返回 null
   */
  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return null;
    // 排除 password 字段
    const { password: _, ...result } = user;
    return result;
  }

  /**
   * 用户登录, 校验凭证并签发 JWT
   * @returns { access_token } JWT 令牌, 24 小时有效
   */
  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.username, dto.password);
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const payload = { sub: user.id, username: user.username, role: user.role };
    return { access_token: this.jwtService.sign(payload), user: payload };
  }

  async register(dto: RegisterDto) {
    const password = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invite = await tx.registrationInvite.findUnique({
          where: { code: dto.inviteCode },
        });
        if (!invite || invite.usedAt) {
          throw new BadRequestException('邀请码无效或已使用');
        }

        const claimed = await tx.registrationInvite.updateMany({
          where: { id: invite.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('邀请码无效或已使用');
        }

        return tx.user.create({
          data: {
            username: dto.username,
            password,
            role: invite.role,
          },
          select: { id: true, username: true, role: true, createdAt: true },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('用户名已存在');
      }
      throw error;
    }
  }
}
