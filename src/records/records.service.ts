import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { Prisma, QuestionType, RecordStatus, Role } from '@prisma/client';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

/** 答题记录服务, 处理草稿保存, 答案提交, 自动阅卷和成绩统计 */
@Injectable()
export class RecordsService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
  ) {}

  /** 保存/更新草稿答案 */
  async saveDraft(examId: string, userId: string, dto: SaveDraftDto) {
    const exam = await this.validateAndGetExam(examId, userId);
    const filteredAnswers = this.filterValidAnswers(exam, dto.answers);

    const existing = await this.prisma.record.findUnique({
      where: { examId_userId: { examId, userId } },
    });

    if (existing) {
      if (existing.status === RecordStatus.submitted) {
        throw new BadRequestException('已提交过答案, 无法保存草稿');
      }
      return this.prisma.record.update({
        where: { id: existing.id },
        data: { answers: JSON.stringify(filteredAnswers) },
      });
    }

    return this.prisma.record.create({
      data: {
        examId,
        userId,
        status: RecordStatus.draft,
        answers: JSON.stringify(filteredAnswers),
      },
    });
  }

  /** 获取草稿 (用于恢复答题) */
  async getDraft(examId: string, userId: string) {
    await this.requireStudentAssigned(examId, userId);
    const record = await this.prisma.record.findUnique({
      where: { examId_userId: { examId, userId } },
    });

    if (!record) {
      return { answers: {} };
    }

    if (record.status === RecordStatus.submitted) {
      throw new BadRequestException('考试已提交, 无法获取草稿');
    }

    try {
      const answers: unknown = JSON.parse(record.answers);
      return { answers };
    } catch {
      return { answers: {} };
    }
  }

  /**
   * 提交答案并自动阅卷
   * 若已有草稿则升级为已提交, 否则直接创建
   */
  async submit(examId: string, userId: string, dto: SubmitAnswerDto) {
    const exam = await this.validateAndGetExam(examId, userId);
    const filteredAnswers = this.filterValidAnswers(exam, dto.answers);
    const { score, details } = this.grade(
      exam.paper.questions,
      filteredAnswers,
    );

    const existing = await this.prisma.record.findUnique({
      where: { examId_userId: { examId, userId } },
    });

    if (existing) {
      if (existing.status === RecordStatus.submitted) {
        throw new BadRequestException('已提交过答案');
      }
      // 草稿升级为已提交
      return this.prisma.record.update({
        where: { id: existing.id },
        data: {
          status: RecordStatus.submitted,
          answers: JSON.stringify(details),
          score,
          submittedAt: new Date(),
        },
      });
    }

    // 无草稿, 直接创建已提交记录
    try {
      return await this.prisma.record.create({
        data: {
          examId,
          userId,
          status: RecordStatus.submitted,
          score,
          answers: JSON.stringify(details),
          submittedAt: new Date(),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('已提交过答案');
      }
      throw e;
    }
  }

  /** 教师查看某考试所有已提交成绩 (分页) */
  async findAll(
    examId: string,
    userId: string,
    role: string,
    page = 1,
    pageSize = 20,
  ) {
    await this.requireRecordAccess(examId, userId, role);
    const where = { examId, status: RecordStatus.submitted };
    const [data, total] = await Promise.all([
      this.prisma.record.findMany({
        where,
        include: { user: { select: { id: true, username: true, role: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.record.count({ where }),
    ]);

    return {
      data: data.map((r) => this.formatRecord(r)),
      total,
      page,
      pageSize,
    };
  }

  /** 成绩统计: 最高分/最低分/平均分/参加人数 (仅已提交) */
  async getStats(examId: string, userId: string, role: string) {
    await this.requireRecordAccess(examId, userId, role);
    const records = await this.prisma.record.findMany({
      where: { examId, status: RecordStatus.submitted, score: { not: null } },
      select: { score: true },
    });

    if (records.length === 0) {
      return { count: 0, max: 0, min: 0, avg: 0 };
    }

    const scores = records.map((r) => r.score!);
    return {
      count: scores.length,
      max: Math.max(...scores),
      min: Math.min(...scores),
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    };
  }

  /** 校验考试存在且在考试时间窗口内 */
  private async validateAndGetExam(examId: string, userId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        paper: {
          include: {
            questions: {
              include: { question: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    await this.requireStudentAssigned(examId, userId);

    const now = new Date();
    if (now < exam.startTime) throw new BadRequestException('考试尚未开始');
    if (now > exam.endTime) throw new BadRequestException('考试已结束');

    return exam;
  }

  private async requireStudentAssigned(examId: string, userId: string) {
    const participant = await this.prisma.examParticipant.findUnique({
      where: { examId_userId: { examId, userId } },
    });
    if (!participant) throw new BadRequestException('未被分配参加该考试');
  }

  private async requireRecordAccess(
    examId: string,
    userId: string,
    role: string,
  ) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { paper: { select: { bankId: true } } },
    });
    if (!exam) throw new NotFoundException('考试不存在');

    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        exam.paper.bankId,
        'exam_manager',
      );
    }
  }

  /** 过滤掉不属于该试卷的答案 key */
  private filterValidAnswers(
    exam: { paper: { questions: { question: { id: string } }[] } },
    answers: { [key: string]: string },
  ) {
    const validQuestionIds = new Set(
      exam.paper.questions.map((pq) => pq.question.id),
    );
    const filtered: { [key: string]: string } = {};
    for (const [key, val] of Object.entries(answers)) {
      if (validQuestionIds.has(key)) {
        filtered[key] = val;
      }
    }
    return filtered;
  }

  /**
   * 自动阅卷逻辑
   * 返回每题得分明细和总分
   */
  private grade(
    paperQuestions: {
      question: {
        id: string;
        type: QuestionType;
        answer: string;
        score: number;
      };
    }[],
    answers: { [key: string]: string },
  ) {
    let totalScore = 0;
    const details: {
      [key: string]: {
        answer: string;
        correct: string;
        score: number;
        earned: number;
      };
    } = {};

    for (const pq of paperQuestions) {
      const q = pq.question;
      const studentAnswer = answers[q.id] ?? '';
      let earned = 0;

      switch (q.type) {
        case QuestionType.single:
        case QuestionType.true_false:
        case QuestionType.fill:
          if (studentAnswer.trim() === q.answer.trim()) {
            earned = q.score;
          }
          break;

        case QuestionType.multiple: {
          const student = studentAnswer
            .split(',')
            .map((s) => s.trim())
            .sort()
            .join(',');
          const correct = q.answer
            .split(',')
            .map((s) => s.trim())
            .sort()
            .join(',');
          if (student === correct) {
            earned = q.score;
          }
          break;
        }

        case QuestionType.short:
        case QuestionType.program:
          earned = 0;
          break;
      }

      totalScore += earned;
      details[q.id] = {
        answer: studentAnswer,
        correct: q.answer,
        score: q.score,
        earned,
      };
    }

    return { score: totalScore, details };
  }

  /** 将 answers 字段从 JSON string 解析为对象 */
  private formatRecord<T extends { answers: string }>(
    record: T,
  ): Omit<T, 'answers'> & { answers: unknown } {
    if (record.answers && typeof record.answers === 'string') {
      try {
        const answers: unknown = JSON.parse(record.answers);
        return { ...record, answers };
      } catch {
        return record;
      }
    }
    return record;
  }
}
