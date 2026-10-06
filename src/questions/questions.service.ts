import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import {
  QuestionImagesService,
  QuestionImage,
} from '../files/question-images.service';
import { Prisma, Question, QuestionType, Role } from '@prisma/client';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { PaginatedResult } from '../common/types/pagination';
import { ImportResultDto } from './dto/import-result.dto';
import {
  serializeTranslations,
  localizeQuestion,
  normalizeLocale,
  LocalizedQuestion,
} from '../common/utils/localize';
import * as ExcelJS from 'exceljs';

const QUESTION_TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  true_false: '判断题',
  fill: '填空题',
  short: '简答题',
  program: '编程题',
};

const LABEL_TO_TYPE: Record<string, QuestionType> = Object.fromEntries(
  Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => [v, k as QuestionType]),
);

@Injectable()
export class QuestionsService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
    private questionImages: QuestionImagesService,
  ) {}

  async create(dto: CreateQuestionDto, userId: string, role: string) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, dto.bankId, 'editor');
    }
    const { options, locale, translations, ...rest } = dto;

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('分类不存在');
      if (category.bankId !== dto.bankId) {
        throw new BadRequestException('分类与当前题库不一致');
      }
    }

    return this.prisma.question.create({
      data: {
        ...rest,
        locale: normalizeLocale(locale),
        ...(options !== undefined && { options: JSON.stringify(options) }),
        ...(translations && {
          translations: serializeTranslations(translations),
        }),
      },
      include: { category: true },
    });
  }

  async findAll(
    query: QueryQuestionDto,
    userId: string,
    role: string,
  ): Promise<
    PaginatedResult<LocalizedQuestion<Question> & { images: QuestionImage[] }>
  > {
    const {
      type,
      categoryId,
      difficulty,
      keyword,
      page = 1,
      pageSize = 20,
      bankId,
    } = query;

    const where: Prisma.QuestionWhereInput = {};
    if (bankId) where.bankId = bankId;
    if (type) where.type = type;
    if (categoryId) where.categoryId = categoryId;
    if (difficulty) where.difficulty = difficulty;
    if (keyword) where.title = { contains: keyword };

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
      this.prisma.question.findMany({
        where,
        include: { category: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      data: await this.questionImages.attach(
        data.map((q) => localizeQuestion(this.parseOptions(q), query.locale)),
      ),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string, locale?: string, userId?: string, role?: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (
      userId &&
      role &&
      role !== Role.super_admin &&
      role !== Role.question_admin
    ) {
      await this.bankPermission.requirePermission(
        userId,
        question.bankId,
        'viewer',
      );
    }
    const [result] = await this.questionImages.attach([
      localizeQuestion(this.parseOptions(question), locale),
    ]);
    return result;
  }

  async update(
    id: string,
    dto: UpdateQuestionDto,
    userId: string,
    role: string,
  ) {
    const existing = await this.prisma.question.findUnique({
      where: { id },
      select: { bankId: true },
    });
    if (!existing) throw new NotFoundException('题目不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        existing.bankId,
        'editor',
      );
    }
    const { options, locale, translations, ...rest } = dto;
    return this.prisma.question.update({
      where: { id },
      data: {
        ...rest,
        ...(locale !== undefined && { locale: normalizeLocale(locale) }),
        ...(options !== undefined && { options: JSON.stringify(options) }),
        ...(translations !== undefined && {
          translations: serializeTranslations(translations),
        }),
      },
      include: { category: true },
    });
  }

  async remove(id: string, userId: string, role: string) {
    const existing = await this.prisma.question.findUnique({
      where: { id },
      select: { bankId: true },
    });
    if (!existing) throw new NotFoundException('题目不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        existing.bankId,
        'editor',
      );
    }
    const ref = await this.prisma.paperQuestion.count({
      where: { questionId: id },
    });
    if (ref > 0) {
      throw new BadRequestException(`该题目已被 ${ref} 份试卷引用, 无法删除`);
    }
    await this.questionImages.removeForQuestion(id);
    return this.prisma.question.delete({ where: { id } });
  }

  async exportToExcel(
    bankId: string,
    categoryId: string | undefined,
    userId: string,
    role: string,
  ): Promise<Buffer> {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, bankId, 'viewer');
    }
    const where: Prisma.QuestionWhereInput = { bankId };
    if (categoryId) where.categoryId = categoryId;

    const questions = await this.prisma.question.findMany({
      where,
      include: { category: true },
      orderBy: { id: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('题目');

    sheet.columns = [
      { header: '标题', key: 'title', width: 40 },
      { header: '题型', key: 'type', width: 12 },
      { header: '选项', key: 'options', width: 50 },
      { header: '答案', key: 'answer', width: 30 },
      { header: '解析', key: 'analysis', width: 40 },
      { header: '难度', key: 'difficulty', width: 8 },
      { header: '分值', key: 'score', width: 8 },
      { header: '分类', key: 'category', width: 20 },
      { header: '主语言', key: 'locale', width: 8 },
      { header: '翻译', key: 'translations', width: 60 },
    ];

    for (const q of questions) {
      sheet.addRow({
        title: q.title,
        type: QUESTION_TYPE_LABEL[q.type] ?? q.type,
        options: q.options ?? '',
        answer: q.answer,
        analysis: q.analysis ?? '',
        difficulty: q.difficulty,
        score: q.score,
        category: q.category?.name ?? '',
        locale: q.locale ?? 'zh',
        translations: q.translations ?? '',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async importFromExcel(
    bankId: string,
    file: Express.Multer.File,
    userId: string,
    role: string,
  ): Promise<ImportResultDto> {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, bankId, 'editor');
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(file.buffer).buffer);
    const sheet = workbook.worksheets[0];

    if (!sheet || sheet.rowCount < 2) {
      return {
        total: 0,
        success: 0,
        failed: 0,
        errors: [{ row: 0, message: 'Excel 无数据行' }],
      };
    }

    const categories = await this.prisma.category.findMany({
      where: { bankId },
    });
    const categoryNameMap = new Map(categories.map((c) => [c.name, c.id]));

    const errors: { row: number; message: string }[] = [];
    let success = 0;

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const title = row.getCell(1).text?.trim();
      const typeLabel = row.getCell(2).text?.trim();
      const optionsStr = row.getCell(3).text?.trim();
      const answer = row.getCell(4).text?.trim();
      const analysis = row.getCell(5).text?.trim();
      const difficultyStr = row.getCell(6).text?.trim();
      const scoreStr = row.getCell(7).text?.trim();
      const categoryName = row.getCell(8).text?.trim();
      const localeStr = row.getCell(9).text?.trim();
      const translationsStr = row.getCell(10).text?.trim();

      if (!title && !typeLabel && !answer) continue;

      if (!title) {
        errors.push({ row: rowNum, message: '标题不能为空' });
        continue;
      }
      if (!typeLabel) {
        errors.push({ row: rowNum, message: '题型不能为空' });
        continue;
      }
      if (!answer) {
        errors.push({ row: rowNum, message: '答案不能为空' });
        continue;
      }

      const type = LABEL_TO_TYPE[typeLabel];
      if (!type) {
        errors.push({ row: rowNum, message: `无效题型: ${typeLabel}` });
        continue;
      }

      let options: string | undefined;
      if (optionsStr) {
        try {
          JSON.parse(optionsStr);
          options = optionsStr;
        } catch {
          errors.push({ row: rowNum, message: '选项格式无效 (需为 JSON)' });
          continue;
        }
      }

      const difficulty = difficultyStr ? parseInt(difficultyStr, 10) : 1;
      const score = scoreStr ? parseInt(scoreStr, 10) : 1;
      if (isNaN(difficulty) || difficulty < 1 || difficulty > 5) {
        errors.push({ row: rowNum, message: '难度需为 1-5 的整数' });
        continue;
      }
      if (isNaN(score) || score < 1) {
        errors.push({ row: rowNum, message: '分值需为正整数' });
        continue;
      }

      let categoryId: string | undefined;
      if (categoryName) {
        categoryId = categoryNameMap.get(categoryName);
        if (!categoryId) {
          errors.push({ row: rowNum, message: `分类不存在: ${categoryName}` });
          continue;
        }
      }

      const locale = normalizeLocale(localeStr || undefined);
      let translations: string | undefined;
      if (translationsStr) {
        try {
          JSON.parse(translationsStr);
          translations = translationsStr;
        } catch {
          errors.push({ row: rowNum, message: '翻译格式无效 (需为 JSON)' });
          continue;
        }
      }

      try {
        await this.prisma.question.create({
          data: {
            title,
            type,
            options,
            answer,
            analysis: analysis || undefined,
            difficulty,
            score,
            categoryId,
            locale,
            translations,
            bankId,
          },
        });
        success++;
      } catch (error) {
        errors.push({
          row: rowNum,
          message: error instanceof Error ? error.message : '创建失败',
        });
      }
    }

    const total = sheet.rowCount - 1;
    return { total, success, failed: errors.length, errors };
  }

  private parseOptions<T extends Question>(question: T) {
    if (question.options && typeof question.options === 'string') {
      try {
        return {
          ...question,
          options: JSON.parse(question.options) as unknown,
        };
      } catch {
        return question;
      }
    }
    return question;
  }
}
