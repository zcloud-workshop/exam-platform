import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { QuestionImagesService } from '../files/question-images.service';
import { Prisma, Exam, Question, RecordStatus, Role } from '@prisma/client';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { PaginatedResult } from '../common/types/pagination';

const examInclude = {
  paper: {
    include: {
      questions: {
        include: { question: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  },
  participants: {
    include: { user: { select: { id: true, username: true, role: true } } },
  },
  _count: { select: { records: true, participants: true } },
} satisfies Prisma.ExamInclude;

type ExamWithQuestions = Prisma.ExamGetPayload<{ include: typeof examInclude }>;

/** 考试服务, 管理考试的 CRUD */
@Injectable()
export class ExamsService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
    private questionImages: QuestionImagesService,
  ) {}

  /** 创建考试, 校验试卷存在且时间范围合法 */
  async create(dto: CreateExamDto, userId: string, role: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id: dto.paperId },
    });
    if (!paper) throw new BadRequestException('试卷不存在');

    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        paper.bankId,
        'exam_manager',
      );
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (startTime >= endTime) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const studentIds = await this.validateStudentIds(dto.studentIds ?? []);

    return this.prisma.exam.create({
      data: {
        name: dto.name,
        paperId: dto.paperId,
        startTime,
        endTime,
        showScore: dto.showScore ?? false,
        participants: { create: studentIds.map((userId) => ({ userId })) },
      },
      include: examInclude,
    });
  }

  /** 分页查询考试, 支持按名称搜索 */
  async findAll(
    query: QueryExamDto,
    userId: string,
    role: string,
  ): Promise<PaginatedResult<Exam>> {
    const { keyword, bankId, page = 1, pageSize = 20 } = query;

    const where: Prisma.ExamWhereInput = {};
    if (keyword) where.name = { contains: keyword };

    if (role === Role.student) {
      where.participants = { some: { userId } };
    } else if (role !== Role.super_admin && role !== Role.question_admin) {
      const accessibleIds =
        await this.bankPermission.getAccessibleBankIds(userId);
      where.paper = { bankId: { in: accessibleIds } };
      if (bankId) {
        if (!accessibleIds.includes(bankId)) {
          return { data: [], total: 0, page, pageSize };
        }
        where.paper = { bankId };
      }
    } else if (bankId) {
      where.paper = { bankId };
    }

    const [data, total] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        include: {
          ...examInclude,
          paper: { include: { questions: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.exam.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** 查询考试详情, 含试卷和题目信息 */
  async findOne(id: string, userId: string, role: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: examInclude,
    });
    if (!exam) throw new NotFoundException('考试不存在');
    if (role === Role.student) {
      await this.requireStudentAssigned(id, userId);
    } else if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        exam.paper.bankId,
        'viewer',
      );
    }
    const visibleExam =
      role === Role.student ? this.stripExamAnswers(exam) : exam;
    const [paper] = await this.questionImages.attachToPapers([
      visibleExam.paper,
    ]);
    return { ...visibleExam, paper };
  }

  /** 更新考试信息 */
  async update(id: string, dto: UpdateExamDto, userId: string, role: string) {
    const existing = await this.prisma.exam.findUnique({
      where: { id },
      select: { paper: { select: { bankId: true } } },
    });
    if (!existing) throw new NotFoundException('考试不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        existing.paper.bankId,
        'exam_manager',
      );
    }
    const { studentIds, ...rest } = dto;
    const data: Prisma.ExamUncheckedUpdateInput = { ...rest };
    if (dto.startTime) data.startTime = new Date(dto.startTime);
    if (dto.endTime) data.endTime = new Date(dto.endTime);

    // 校验时间范围
    const start =
      data.startTime ??
      (await this.prisma.exam.findUnique({ where: { id } }))!.startTime;
    const end =
      data.endTime ??
      (await this.prisma.exam.findUnique({ where: { id } }))!.endTime;
    if (start >= end) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    if (studentIds !== undefined) {
      const uniqueStudentIds = await this.validateStudentIds(studentIds);
      return this.prisma.$transaction(async (tx) => {
        await tx.examParticipant.deleteMany({ where: { examId: id } });
        return tx.exam.update({
          where: { id },
          data: {
            ...data,
            participants: {
              create: uniqueStudentIds.map((userId) => ({ userId })),
            },
          },
          include: examInclude,
        });
      });
    }

    return this.prisma.exam.update({
      where: { id },
      data,
      include: examInclude,
    });
  }

  /** 删除考试, 有已提交记录时拒绝 (草稿不阻止) */
  async remove(id: string, userId: string, role: string) {
    await this.findOne(id, userId, role);
    const submittedCount = await this.prisma.record.count({
      where: { examId: id, status: RecordStatus.submitted },
    });
    if (submittedCount > 0) {
      throw new BadRequestException('该考试已有答题记录, 无法删除');
    }
    // 清除草稿记录后删除
    await this.prisma.record.deleteMany({
      where: { examId: id, status: RecordStatus.draft },
    });
    await this.prisma.examParticipant.deleteMany({ where: { examId: id } });
    return this.prisma.exam.delete({ where: { id } });
  }

  private stripExamAnswers(exam: ExamWithQuestions) {
    return {
      ...exam,
      paper: {
        ...exam.paper,
        questions: exam.paper.questions.map((paperQuestion) => ({
          ...paperQuestion,
          question: this.stripQuestionAnswer(paperQuestion.question),
        })),
      },
    };
  }

  private stripQuestionAnswer(question: Question) {
    const { answer: _answer, analysis: _analysis, ...safeQuestion } = question;
    if (safeQuestion.translations) {
      safeQuestion.translations = this.stripTranslationAnswers(
        safeQuestion.translations,
      );
    }
    return safeQuestion;
  }

  private stripTranslationAnswers(translations: string) {
    try {
      const parsed: unknown = JSON.parse(translations);
      if (parsed === null) return null;
      const safe: Record<string, unknown> = {};
      const entries: [string, unknown][] =
        typeof parsed === 'object' ? Object.entries(parsed) : [];
      for (const [locale, value] of entries) {
        if (!value || typeof value !== 'object') continue;
        const {
          answer: _answer,
          analysis: _analysis,
          ...safeTranslation
        } = value as Record<string, unknown>;
        safe[locale] = safeTranslation;
      }
      return JSON.stringify(safe);
    } catch {
      return null;
    }
  }

  private async validateStudentIds(studentIds: string[]) {
    if (studentIds.length === 0) return [];
    const uniqueIds = [...new Set(studentIds)];
    const students = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, role: Role.student },
      select: { id: true },
    });
    if (students.length !== uniqueIds.length) {
      throw new BadRequestException('部分学生不存在或不是学生角色');
    }
    return uniqueIds;
  }

  private async requireStudentAssigned(examId: string, userId: string) {
    const participant = await this.prisma.examParticipant.findUnique({
      where: { examId_userId: { examId, userId } },
    });
    if (!participant) throw new ForbiddenException('未被分配参加该考试');
  }
}
