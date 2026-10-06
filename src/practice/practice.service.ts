import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionImagesService } from '../files/question-images.service';
import { QueryPracticeDto } from './dto/query-practice.dto';
import {
  QueryPracticeCollectionDto,
  QueryPracticeHistoryDto,
} from './dto/query-personal-practice.dto';

const GUEST_QUESTION_LIMIT = 50;

const practiceSelect = {
  id: true,
  title: true,
  type: true,
  options: true,
  difficulty: true,
  score: true,
  locale: true,
  translations: true,
} satisfies Prisma.QuestionSelect;

type PracticeQuestion = Prisma.QuestionGetPayload<{
  select: typeof practiceSelect;
}>;

type PracticeTranslations = Record<
  string,
  { title?: unknown; options?: unknown }
>;

@Injectable()
export class PracticeService {
  constructor(
    private prisma: PrismaService,
    private questionImages: QuestionImagesService,
  ) {}

  async getPublicBanks() {
    return this.prisma.questionBank.findMany({
      where: { isPublic: true },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getQuestions(
    bankId: string,
    mode: 'random' | 'sequential',
    userId?: string,
  ) {
    return this.presentQuestions(
      await this.loadQuestions(bankId, mode, Boolean(userId)),
      userId,
    );
  }

  async getQuestionPage(
    bankId: string,
    query: QueryPracticeDto,
    userId?: string,
  ) {
    const { mode = 'sequential', pageSize = 50 } = query;
    let page = query.page ?? 1;
    const seed = query.seed ?? randomUUID();
    if (query.collection && !userId)
      throw new UnauthorizedException('请登录后查看个人练习');
    await this.requirePublicBank(bankId);
    const questionIndex = await this.loadQuestionIndex(
      bankId,
      query.collection,
      userId,
    );
    const questions = this.accessibleQuestions(
      questionIndex,
      mode,
      Boolean(userId),
      seed,
    );
    const keyword = query.keyword?.trim().toLowerCase();
    let matches = questions.map((question, index) => ({ ...question, index }));
    if (keyword) {
      const searchableQuestions = await this.prisma.question.findMany({
        where: { bankId, id: { in: questions.map((question) => question.id) } },
        select: practiceSelect,
      });
      const matchingIds = new Set(
        searchableQuestions
          .filter((item) => {
            const question = this.parseQuestion(item);
            const texts = [
              question.title,
              ...this.optionTexts(question.options),
              ...Object.values(question.translations ?? {}).flatMap(
                (translation) => [
                  translation.title,
                  ...this.optionTexts(translation.options),
                ],
              ),
            ];
            return texts.some(
              (text) =>
                typeof text === 'string' &&
                text.toLowerCase().includes(keyword),
            );
          })
          .map((question) => question.id),
      );
      matches = matches.filter((question) => matchingIds.has(question.id));
    }
    let initialIndex = 0;
    if (query.questionId) {
      const matchIndex = matches.findIndex(
        (question) => question.id === query.questionId,
      );
      if (matchIndex < 0) throw new NotFoundException('题目不在当前练习范围内');
      initialIndex = matches[matchIndex].index;
      page = Math.floor(matchIndex / pageSize) + 1;
    }
    const pageQuestions = matches.slice((page - 1) * pageSize, page * pageSize);
    const details =
      pageQuestions.length === 0
        ? []
        : await this.prisma.question.findMany({
            where: {
              bankId,
              id: { in: pageQuestions.map((question) => question.id) },
            },
            select: practiceSelect,
          });
    const questionsById = new Map(
      details.map((question) => [question.id, question]),
    );
    return {
      data: await this.presentQuestions(
        pageQuestions.flatMap(({ id, index }) => {
          const question = questionsById.get(id);
          return question ? [{ ...question, index }] : [];
        }),
        userId,
      ),
      total: matches.length,
      questionTotal: questionIndex.length,
      practiceTotal: questions.length,
      matchingIndexes: keyword
        ? matches.map((question) => question.index)
        : undefined,
      page,
      pageSize,
      seed,
      initialIndex,
    };
  }

  async getQuestion(bankId: string, questionId: string, userId?: string) {
    await this.requirePublicBank(bankId);
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, bankId },
      select: practiceSelect,
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (!userId) await this.requireGuestQuestion(bankId, questionId);
    const [visibleQuestion] = await this.presentQuestions([question], userId);
    return visibleQuestion;
  }

  private optionTexts(options: unknown): unknown[] {
    return options && typeof options === 'object' ? Object.values(options) : [];
  }

  private async requirePublicBank(bankId: string) {
    const bank = await this.prisma.questionBank.findUnique({
      where: { id: bankId },
    });
    if (!bank || !bank.isPublic) {
      throw new NotFoundException('题库不存在或未公开');
    }
  }

  private async loadQuestions(
    bankId: string,
    mode: 'random' | 'sequential',
    authenticated: boolean,
  ) {
    await this.requirePublicBank(bankId);
    const questions = await this.prisma.question.findMany({
      where: { bankId },
      select: practiceSelect,
      orderBy: mode === 'random' ? undefined : { id: 'asc' },
    });

    return this.accessibleQuestions(questions, mode, authenticated);
  }

  private loadQuestionIndex(
    bankId: string,
    collection?: 'wrong' | 'favorites',
    userId?: string,
  ) {
    return this.prisma.question.findMany({
      where: {
        bankId,
        ...(collection && {
          practiceQuestions: {
            some: {
              userId,
              ...(collection === 'wrong'
                ? { isWrong: true }
                : { isFavorite: true }),
            },
          },
        }),
      },
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });
  }

  private async requireGuestQuestion(bankId: string, questionId: string) {
    const questions = this.accessibleQuestions(
      await this.loadQuestionIndex(bankId),
      'sequential',
      false,
    );
    if (!questions.some((question) => question.id === questionId)) {
      throw new ForbiddenException('请登录后继续练习');
    }
  }

  private accessibleQuestions<T extends { id: string; title: string }>(
    questions: T[],
    mode: 'random' | 'sequential',
    authenticated: boolean,
    seed?: string,
  ): T[] {
    if (!authenticated && mode === 'random') {
      throw new ForbiddenException('请登录后使用随机练习');
    }
    const ordered = this.orderQuestions(questions, mode, seed);
    return authenticated ? ordered : ordered.slice(0, GUEST_QUESTION_LIMIT);
  }

  private orderQuestions<T extends { id: string; title: string }>(
    questions: T[],
    mode: 'random' | 'sequential',
    seed?: string,
  ): T[] {
    if (mode === 'random' && seed !== undefined) {
      const keys = new Map(
        questions.map((question) => [
          question.id,
          createHash('sha256').update(`${seed}:${question.id}`).digest('hex'),
        ]),
      );
      questions.sort((left, right) =>
        keys.get(left.id)!.localeCompare(keys.get(right.id)!),
      );
    } else if (mode === 'random') {
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    } else {
      questions.sort((left, right) => {
        const leftNumber = Number(
          left.title.match(/^\s*Question\s*#\s*(\d+)\b/i)?.[1] ??
            Number.MAX_SAFE_INTEGER,
        );
        const rightNumber = Number(
          right.title.match(/^\s*Question\s*#\s*(\d+)\b/i)?.[1] ??
            Number.MAX_SAFE_INTEGER,
        );
        return leftNumber - rightNumber;
      });
    }

    return questions;
  }

  private parseQuestion<T extends PracticeQuestion>(q: T) {
    let parsedOptions: unknown = q.options;
    if (typeof parsedOptions === 'string') {
      try {
        parsedOptions = JSON.parse(parsedOptions);
      } catch {
        /* keep as-is */
      }
    }

    // Parse translations and strip answer/analysis from each locale
    let parsedTranslations: PracticeTranslations | null = null;
    if (q.translations) {
      try {
        const raw = JSON.parse(q.translations) as PracticeTranslations;
        // Only keep title and options for each locale (strip answer/analysis)
        const safe: PracticeTranslations = {};
        for (const [locale, tr] of Object.entries(raw)) {
          safe[locale] = {
            ...(tr.title ? { title: tr.title } : {}),
            ...(tr.options !== undefined
              ? {
                  options:
                    typeof tr.options === 'string'
                      ? (JSON.parse(tr.options) as unknown)
                      : tr.options,
                }
              : {}),
          };
        }
        parsedTranslations = safe;
      } catch {
        /* keep as-is */
      }
    }

    return { ...q, options: parsedOptions, translations: parsedTranslations };
  }

  private async presentQuestions<T extends PracticeQuestion>(
    questions: T[],
    userId?: string,
  ) {
    const states =
      userId && questions.length
        ? await this.prisma.userPracticeQuestion.findMany({
            where: {
              userId,
              questionId: { in: questions.map((question) => question.id) },
            },
            select: { questionId: true, isFavorite: true, isWrong: true },
          })
        : [];
    const byId = new Map(states.map((state) => [state.questionId, state]));
    return this.questionImages.attach(
      questions.map((question) => ({
        ...this.parseQuestion(question),
        isFavorite: byId.get(question.id)?.isFavorite ?? false,
        isWrong: byId.get(question.id)?.isWrong ?? false,
      })),
    );
  }

  async checkAnswer(
    bankId: string,
    questionId: string,
    dto: { userAnswer: string },
    userId?: string,
  ) {
    await this.requirePublicBank(bankId);

    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question || question.bankId !== bankId) {
      throw new NotFoundException('题目不存在');
    }
    if (!userId) await this.requireGuestQuestion(bankId, questionId);

    const correctAnswer = question.answer.trim();
    const userAnswer = dto.userAnswer.trim();

    const graded = question.type !== 'short' && question.type !== 'program';
    let correct = false;
    if (question.type === 'multiple') {
      const user = userAnswer
        .split(',')
        .map((s) => s.trim())
        .sort()
        .join(',');
      const expected = correctAnswer
        .split(',')
        .map((s) => s.trim())
        .sort()
        .join(',');
      correct = user === expected;
    } else if (question.type === 'short' || question.type === 'program') {
      // 无法自动判分, 总是显示答案
      correct = false;
    } else {
      correct = userAnswer === correctAnswer;
    }

    if (userId) {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.userPracticeQuestion.createMany({
          data: [{ userId, questionId }],
          skipDuplicates: true,
        });
        await tx.userPracticeQuestion.update({
          where: { userId_questionId: { userId, questionId } },
          data: {
            attemptCount: { increment: 1 },
            lastAttemptAt: now,
            ...(graded && { isWrong: !correct }),
            ...(graded && !correct && { wrongCount: { increment: 1 } }),
          },
        });
        await tx.practiceAttempt.create({
          data: {
            userId,
            questionId,
            userAnswer: dto.userAnswer,
            correct: graded ? correct : null,
            answer: question.answer,
            analysis: question.analysis,
            createdAt: now,
          },
        });
      });
    }

    return {
      correct,
      graded,
      answer: question.answer,
      analysis: question.analysis,
    };
  }

  async setFavorite(
    bankId: string,
    questionId: string,
    userId: string,
    isFavorite: boolean,
  ) {
    await this.requirePublicBank(bankId);
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, bankId },
      select: { id: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (isFavorite) {
      await this.prisma.$transaction(async (tx) => {
        await tx.userPracticeQuestion.createMany({
          data: [{ userId, questionId }],
          skipDuplicates: true,
        });
        await tx.userPracticeQuestion.update({
          where: { userId_questionId: { userId, questionId } },
          data: { isFavorite: true, favoritedAt: new Date() },
        });
      });
    } else {
      await this.prisma.userPracticeQuestion.updateMany({
        where: { userId, questionId },
        data: { isFavorite: false, favoritedAt: null },
      });
    }
    return { isFavorite };
  }

  async removeWrongQuestion(questionId: string, userId: string) {
    await this.prisma.userPracticeQuestion.updateMany({
      where: { userId, questionId, question: { bank: { isPublic: true } } },
      data: { isWrong: false },
    });
    return { success: true };
  }

  async getSummary(userId: string) {
    const where = { userId, question: { bank: { isPublic: true } } };
    const [wrongCount, favoriteCount, attemptCount, correctCount, gradedCount] =
      await this.prisma.$transaction([
        this.prisma.userPracticeQuestion.count({
          where: { ...where, isWrong: true },
        }),
        this.prisma.userPracticeQuestion.count({
          where: { ...where, isFavorite: true },
        }),
        this.prisma.practiceAttempt.count({ where }),
        this.prisma.practiceAttempt.count({
          where: { ...where, correct: true },
        }),
        this.prisma.practiceAttempt.count({
          where: { ...where, correct: { not: null } },
        }),
      ]);
    return {
      wrongCount,
      favoriteCount,
      attemptCount,
      correctCount,
      gradedCount,
    };
  }

  async getCollection(userId: string, query: QueryPracticeCollectionDto) {
    const { page = 1, pageSize = 20, collection, bankId } = query;
    const where: Prisma.UserPracticeQuestionWhereInput = {
      userId,
      question: { bank: { isPublic: true }, ...(bankId && { bankId }) },
      ...(collection === 'wrong' ? { isWrong: true } : { isFavorite: true }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.userPracticeQuestion.count({ where }),
      this.prisma.userPracticeQuestion.findMany({
        where,
        include: {
          question: {
            select: {
              ...practiceSelect,
              bank: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [
          {
            ...(collection === 'wrong'
              ? { lastAttemptAt: 'desc' as const }
              : { favoritedAt: 'desc' as const }),
          },
          { questionId: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const questions = await this.presentQuestions(
      items.map(({ question: { bank, ...question } }) => question),
      userId,
    );
    return {
      data: items.map((item, index) => ({
        question: questions[index],
        bank: item.question.bank,
        attemptCount: item.attemptCount,
        wrongCount: item.wrongCount,
        lastAttemptAt: item.lastAttemptAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getHistory(userId: string, query: QueryPracticeHistoryDto) {
    const { page = 1, pageSize = 20, bankId } = query;
    const where: Prisma.PracticeAttemptWhereInput = {
      userId,
      question: { bank: { isPublic: true }, ...(bankId && { bankId }) },
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.practiceAttempt.count({ where }),
      this.prisma.practiceAttempt.findMany({
        where,
        include: {
          question: {
            select: {
              ...practiceSelect,
              bank: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const questions = await this.presentQuestions(
      items.map(({ question: { bank, ...question } }) => question),
      userId,
    );
    return {
      data: items.map((item, index) => ({
        id: item.id,
        userAnswer: item.userAnswer,
        correct: item.correct,
        answer: item.answer,
        analysis: item.analysis,
        createdAt: item.createdAt,
        question: questions[index],
        bank: item.question.bank,
      })),
      total,
      page,
      pageSize,
    };
  }
}
