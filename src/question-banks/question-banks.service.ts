import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { CreateQuestionBankDto } from './dto/create-question-bank.dto';
import { UpdateQuestionBankDto } from './dto/update-question-bank.dto';
import { QueryQuestionBankDto } from './dto/query-question-bank.dto';
import { CreateShareDto } from './dto/create-share.dto';
import { Prisma, Role } from '@prisma/client';

@Injectable()
export class QuestionBanksService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
  ) {}

  async create(dto: CreateQuestionBankDto, userId: string) {
    return this.prisma.questionBank.create({
      data: {
        name: dto.name,
        description: dto.description,
        isPublic: dto.isPublic ?? false,
        createdBy: userId,
      },
      include: {
        creator: { select: { id: true, username: true } },
        _count: { select: { questions: true, categories: true, papers: true } },
      },
    });
  }

  async findAll(query: QueryQuestionBankDto, userId: string, role: string) {
    const { page = 1, pageSize = 20, keyword, isPublic } = query;
    const where: Prisma.QuestionBankWhereInput = {};
    if (keyword) {
      where.name = { contains: keyword };
    }
    if (isPublic !== undefined) {
      where.isPublic = isPublic;
    }

    // Non-admin users only see owned + shared banks
    if (role !== Role.super_admin && role !== Role.question_admin) {
      where.OR = [{ createdBy: userId }, { shares: { some: { userId } } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.questionBank.findMany({
        where,
        include: {
          creator: { select: { id: true, username: true } },
          _count: {
            select: { questions: true, categories: true, papers: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.questionBank.count({ where }),
    ]);

    // Append permission for each bank
    const dataWithPermission = await Promise.all(
      data.map(async (bank) => {
        const permission = await this.bankPermission.getPermission(
          userId,
          bank.id,
        );
        return { ...bank, permission };
      }),
    );

    return { data: dataWithPermission, total, page, pageSize };
  }

  async update(
    id: string,
    dto: UpdateQuestionBankDto,
    userId: string,
    role: string,
  ) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('题库不存在');

    if (role !== Role.super_admin && role !== Role.question_admin) {
      if (bank.createdBy !== userId) {
        throw new ForbiddenException('只有题库所有者可以编辑');
      }
    }

    if (dto.createdBy !== undefined) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: dto.createdBy },
        select: { role: true },
      });
      if (!targetUser) throw new NotFoundException('目标用户不存在');
      if (targetUser.role === Role.student) {
        throw new BadRequestException('题库只能转移给管理员或教师');
      }
    }

    return this.prisma.questionBank.update({
      where: { id },
      data: dto,
      include: {
        creator: { select: { id: true, username: true } },
        _count: { select: { questions: true, categories: true, papers: true } },
      },
    });
  }

  async remove(id: string, userId: string, role: string) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('题库不存在');

    if (role !== Role.super_admin && role !== Role.question_admin) {
      if (bank.createdBy !== userId) {
        throw new ForbiddenException('只有题库所有者可以删除');
      }
    }

    const [questionCount, categoryCount, paperCount] = await Promise.all([
      this.prisma.question.count({ where: { bankId: id } }),
      this.prisma.category.count({ where: { bankId: id } }),
      this.prisma.paper.count({ where: { bankId: id } }),
    ]);
    if (questionCount > 0)
      throw new BadRequestException('题库下存在题目, 无法删除');
    if (categoryCount > 0)
      throw new BadRequestException('题库下存在分类, 无法删除');
    if (paperCount > 0)
      throw new BadRequestException('题库下存在试卷, 无法删除');

    return this.prisma.questionBank.delete({ where: { id } });
  }

  // --- Share methods ---

  private async checkOwnerOrAdmin(
    bankId: string,
    userId: string,
    role: string,
  ) {
    const bank = await this.prisma.questionBank.findUnique({
      where: { id: bankId },
    });
    if (!bank) throw new NotFoundException('题库不存在');

    if (role !== Role.super_admin && role !== Role.question_admin) {
      if (bank.createdBy !== userId) {
        throw new ForbiddenException('只有题库所有者可以管理分享');
      }
    }
  }

  async addShare(
    bankId: string,
    dto: CreateShareDto,
    userId: string,
    role: string,
  ) {
    await this.checkOwnerOrAdmin(bankId, userId, role);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!targetUser) throw new NotFoundException('目标用户不存在');
    if (targetUser.role !== Role.teacher) {
      throw new BadRequestException('只能分享给教师');
    }

    const existing = await this.prisma.bankShare.findUnique({
      where: { bankId_userId: { bankId, userId: dto.userId } },
    });
    if (existing) {
      return this.prisma.bankShare.update({
        where: { id: existing.id },
        data: { role: dto.role },
        include: { user: { select: { id: true, username: true } } },
      });
    }

    return this.prisma.bankShare.create({
      data: { bankId, userId: dto.userId, role: dto.role },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async listShares(bankId: string, userId: string, role: string) {
    await this.checkOwnerOrAdmin(bankId, userId, role);

    return this.prisma.bankShare.findMany({
      where: { bankId },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async removeShare(
    bankId: string,
    shareId: string,
    userId: string,
    role: string,
  ) {
    await this.checkOwnerOrAdmin(bankId, userId, role);

    const share = await this.prisma.bankShare.findUnique({
      where: { id: shareId },
    });
    if (!share || share.bankId !== bankId) {
      throw new NotFoundException('分享记录不存在');
    }

    return this.prisma.bankShare.delete({ where: { id: shareId } });
  }
}
