import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { QuestionImagesService } from '../files/question-images.service';
import { Prisma, Paper, Role } from '@prisma/client';
import { CreatePaperDto } from './dto/create-paper.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';
import { QueryPaperDto } from './dto/query-paper.dto';
import { PaginatedResult } from '../common/types/pagination';

@Injectable()
export class PapersService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
    private questionImages: QuestionImagesService,
  ) {}

  async create(dto: CreatePaperDto, userId: string, role: string) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, dto.bankId, 'editor');
    }
    const { questionIds, bankId, ...rest } = dto;

    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, score: true, bankId: true },
    });

    if (questions.length !== questionIds.length) {
      throw new BadRequestException('部分题目不存在');
    }

    for (const q of questions) {
      if (q.bankId !== bankId) {
        throw new BadRequestException('试卷只能包含同一题库的题目');
      }
    }

    const actualTotal = questions.reduce((sum, q) => sum + q.score, 0);

    return this.prisma.paper.create({
      data: {
        name: rest.name,
        duration: rest.duration,
        totalScore: actualTotal,
        bankId,
        questions: {
          create: questionIds.map((questionId, index) => ({
            questionId,
            sortOrder: index,
          })),
        },
      },
      include: {
        questions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async findAll(
    query: QueryPaperDto,
    userId: string,
    role: string,
  ): Promise<PaginatedResult<Paper>> {
    const { keyword, bankId, page = 1, pageSize = 20 } = query;

    const where: Prisma.PaperWhereInput = {};
    if (bankId) where.bankId = bankId;
    if (keyword) where.name = { contains: keyword };

    if (role !== Role.super_admin && role !== Role.question_admin) {
      const accessibleIds =
        await this.bankPermission.getAccessibleBankIds(userId);
      if (bankId) {
        if (!accessibleIds.includes(bankId)) {
          return { data: [], total: 0, page, pageSize };
        }
      } else {
        where.bankId = { in: accessibleIds };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.paper.findMany({
        where,
        include: {
          questions: {
            include: { question: true },
            orderBy: { sortOrder: 'asc' },
          },
          _count: { select: { exams: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paper.count({ where }),
    ]);

    return {
      data: await this.questionImages.attachToPapers(data),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string, userId: string, role: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      include: {
        questions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { exams: true } },
      },
    });
    if (!paper) throw new NotFoundException('试卷不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        paper.bankId,
        'viewer',
      );
    }
    const [result] = await this.questionImages.attachToPapers([paper]);
    return result;
  }

  async update(id: string, dto: UpdatePaperDto, userId: string, role: string) {
    const existing = await this.prisma.paper.findUnique({
      where: { id },
      select: { bankId: true },
    });
    if (!existing) throw new NotFoundException('试卷不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        existing.bankId,
        'editor',
      );
    }
    const { questionIds, ...rest } = dto;

    if (questionIds !== undefined) {
      const paper = await this.prisma.paper.findUnique({ where: { id } });
      const questions = await this.prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, score: true, bankId: true },
      });
      if (questions.length !== questionIds.length) {
        throw new BadRequestException('部分题目不存在');
      }
      for (const q of questions) {
        if (q.bankId !== paper!.bankId) {
          throw new BadRequestException('试卷只能包含同一题库的题目');
        }
      }
      const actualTotal = questions.reduce((sum, q) => sum + q.score, 0);
      await this.prisma.paperQuestion.deleteMany({ where: { paperId: id } });

      return this.prisma.paper.update({
        where: { id },
        data: {
          ...rest,
          totalScore: actualTotal,
          questions: {
            create: questionIds.map((questionId, index) => ({
              questionId,
              sortOrder: index,
            })),
          },
        },
        include: {
          questions: {
            include: { question: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
    }

    return this.prisma.paper.update({
      where: { id },
      data: rest,
      include: {
        questions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async remove(id: string, userId: string, role: string) {
    const paper = await this.findOne(id, userId, role);
    if (paper._count.exams > 0) {
      throw new BadRequestException('该试卷已被考试引用, 无法删除');
    }
    return this.prisma.paper.delete({ where: { id } });
  }
}
