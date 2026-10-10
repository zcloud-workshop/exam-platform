import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateRegistrationInviteDto } from './dto/create-registration-invite.dto';

/** bcrypt 加密轮数 */
const SALT_ROUNDS = 10;

/** 查询用户时统一排除 password 字段的 select 配置 */
const USER_SELECT = {
  id: true,
  username: true,
  role: true,
  createdAt: true,
};

/** 用户服务, 处理用户的 CRUD 操作和密码哈希 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  createRegistrationInvite(dto: CreateRegistrationInviteDto) {
    return this.prisma.registrationInvite.create({
      data: { code: randomBytes(16).toString('hex'), role: dto.role },
    });
  }

  findRegistrationInvites() {
    return this.prisma.registrationInvite.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeRegistrationInvite(id: string) {
    const deleted = await this.prisma.registrationInvite.deleteMany({
      where: { id },
    });
    if (deleted.count === 0) throw new NotFoundException('邀请码不存在');
    return { success: true };
  }

  /** 创建用户, 密码自动哈希存储 */
  async create(dto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    return this.prisma.user.create({
      data: { ...dto, password: hashedPassword },
      select: USER_SELECT,
    });
  }

  /** 获取所有用户列表, 不含密码 */
  async findAll() {
    return this.prisma.user.findMany({ select: USER_SELECT });
  }

  /** 根据 ID 查询单个用户, 不存在则抛出 404 */
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  /** 更新用户信息, 若包含密码字段则重新哈希 */
  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const data = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  }

  /** 删除用户前检查管理员保留和关联数据 */
  async remove(id: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id },
            select: USER_SELECT,
          });
          if (!user) throw new NotFoundException('用户不存在');

          if (user.role === Role.super_admin) {
            const otherAdminCount = await tx.user.count({
              where: { role: Role.super_admin, id: { not: id } },
            });
            if (otherAdminCount === 0) {
              throw new BadRequestException(
                '不能删除最后一个超级管理员, 请先将其他用户设为超级管理员',
              );
            }
          }

          const bankCount = await tx.questionBank.count({
            where: { createdBy: id },
          });
          if (bankCount > 0) {
            throw new BadRequestException(
              `该用户拥有 ${bankCount} 个题库, 请先将全部题库转移给其他用户后再删除`,
            );
          }

          const recordCount = await tx.record.count({
            where: { userId: id },
          });
          if (recordCount > 0) {
            throw new BadRequestException(
              `该用户有 ${recordCount} 条答题记录, 无法删除`,
            );
          }
          const participantCount = await tx.examParticipant.count({
            where: { userId: id },
          });
          if (participantCount > 0) {
            throw new BadRequestException(
              `该用户已被分配到 ${participantCount} 场考试, 无法删除`,
            );
          }
          const shareCount = await tx.bankShare.count({
            where: { userId: id },
          });
          if (shareCount > 0) {
            throw new BadRequestException(
              '该用户仍有题库分享, 请先移除分享关系后再删除',
            );
          }
          return tx.user.delete({ where: { id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          throw new ConflictException('用户数据已变化, 请刷新后重试删除');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('该用户仍有关联数据, 请先处理后再删除');
        }
      }
      throw error;
    }
  }
}
