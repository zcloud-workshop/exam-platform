import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';

export type BankPermission =
  | 'owner'
  | 'viewer'
  | 'editor'
  | 'exam_manager'
  | null;

@Injectable()
export class BankPermissionService {
  constructor(private prisma: PrismaService) {}

  async getPermission(userId: string, bankId: string): Promise<BankPermission> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return null;

    if (user.role === Role.super_admin || user.role === Role.question_admin) {
      return 'owner';
    }

    const bank = await this.prisma.questionBank.findUnique({
      where: { id: bankId },
      select: { createdBy: true },
    });
    if (!bank) return null;

    if (bank.createdBy === userId) return 'owner';

    const share = await this.prisma.bankShare.findUnique({
      where: { bankId_userId: { bankId, userId } },
    });
    if (!share) return null;

    return share.role;
  }

  async requirePermission(
    userId: string,
    bankId: string,
    required: 'viewer' | 'editor' | 'exam_manager',
  ): Promise<BankPermission> {
    const perm = await this.getPermission(userId, bankId);
    if (!perm) {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('无权访问该题库');
    }

    if (perm === 'owner') return perm;

    const hierarchy: Record<string, number> = {
      viewer: 1,
      editor: 2,
      exam_manager: 2,
    };
    if ((hierarchy[perm] ?? 0) < (hierarchy[required] ?? 0)) {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('权限不足');
    }
    return perm;
  }

  async getAccessibleBankIds(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return [];

    if (user.role === Role.super_admin || user.role === Role.question_admin) {
      const allBanks = await this.prisma.questionBank.findMany({
        select: { id: true },
      });
      return allBanks.map((b) => b.id);
    }

    const [owned, shared] = await Promise.all([
      this.prisma.questionBank.findMany({
        where: { createdBy: userId },
        select: { id: true },
      }),
      this.prisma.bankShare.findMany({
        where: { userId },
        select: { bankId: true },
      }),
    ]);

    return [
      ...new Set([...owned.map((b) => b.id), ...shared.map((s) => s.bankId)]),
    ];
  }
}
