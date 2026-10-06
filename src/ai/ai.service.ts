import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { GenerateQuestionsDto } from './dto/generate-questions.dto';
import { RulePaperDto, AiPaperDto } from './dto/smart-paper.dto';
import { TranslateQuestionDto } from './dto/translate-question.dto';
import { Prisma, Role } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { normalizeLocale } from '../common/utils/localize';

type AiQuestionDraft = {
  title?: string | null;
  answer?: string | null;
  analysis?: string | null;
  options?: unknown;
};

const TYPE_LABELS: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  true_false: '判断题',
  fill: '填空题',
  short: '简答题',
  program: '编程题',
};

@Injectable()
export class AiService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    private http: HttpService,
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
  ) {
    this.baseUrl = process.env.OPENAI_BASE_URL || '';
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  }

  private async chat(prompt: string): Promise<string> {
    if (!this.baseUrl || !this.apiKey) {
      throw new BadRequestException(
        '未配置 AI 服务, 请设置 OPENAI_BASE_URL 和 OPENAI_API_KEY',
      );
    }

    const { data } = await firstValueFrom(
      this.http.post<{
        choices?: { message?: { content?: string | null } }[];
      }>(
        `${this.baseUrl}/v1/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                '你是一个专业的考试出题助手. 请严格按要求的 JSON 格式返回结果, 不要包含任何其他文字.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  async generateQuestions(
    dto: GenerateQuestionsDto,
    userId: string,
    role: string,
  ) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, dto.bankId, 'editor');
    }
    const {
      topic,
      type,
      count = 5,
      difficulty,
      categoryId,
      locale,
      bankId,
    } = dto;
    const typeLabel = TYPE_LABELS[type] || type;
    const lang = locale === 'en' ? 'English' : '中文';

    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) throw new BadRequestException('分类不存在');
      if (category.bankId !== bankId)
        throw new BadRequestException('分类与当前题库不一致');
    }

    const prompt = `请根据主题"${topic}"生成 ${count} 道${typeLabel}。
难度级别: ${difficulty || '不限'} (1-5)
语言: ${lang}
要求:
1. 题目标题清晰准确
2. 答案正确
难度级别: ${difficulty || '不限'} (1-5)
要求:
1. 题目标题清晰准确
2. 答案正确
${type === 'single' || type === 'multiple' ? '3. 选项用 JSON 数组格式, 每个选项为 {"label":"A","text":"选项内容"}' : ''}
${type === 'multiple' ? '4. 多选题答案为逗号分隔的正确选项字母, 如 "A,C"' : ''}

请严格按以下 JSON 数组格式返回, 不要包含 markdown 代码块:
[
  {
    "title": "题目标题",
    "options": ${type === 'single' || type === 'multiple' ? '[{"label":"A","text":"选项A"},{"label":"B","text":"选项B"},{"label":"C","text":"选项C"},{"label":"D","text":"选项D"}]' : 'null'},
    "answer": "答案",
    "analysis": "解析说明"
  }
]`;

    const content = await this.chat(prompt);

    let questions: AiQuestionDraft[];
    try {
      const jsonStr = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      questions = JSON.parse(jsonStr) as typeof questions;
    } catch {
      throw new BadRequestException('AI 返回格式异常, 请重试');
    }

    if (!Array.isArray(questions)) {
      throw new BadRequestException('AI 返回格式异常, 请重试');
    }

    const created = [];
    for (const q of questions) {
      if (!q.title || !q.answer) continue;
      const data: Prisma.QuestionUncheckedCreateInput = {
        title: String(q.title),
        type,
        answer: String(q.answer),
        analysis: q.analysis ? String(q.analysis) : null,
        difficulty: difficulty || 3,
        score: 1,
        categoryId: categoryId || null,
        locale: locale || 'zh',
        bankId,
      };
      if (
        q.options &&
        (type === 'single' || type === 'multiple' || type === 'true_false')
      ) {
        data.options =
          typeof q.options === 'string' ? q.options : JSON.stringify(q.options);
      }
      const record = await this.prisma.question.create({
        data,
        include: { category: true },
      });
      created.push(record);
    }

    return { count: created.length, questions: created };
  }

  async generateAnalysis(questionId: string, userId: string, role: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { bankId: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        question.bankId,
        'editor',
      );
    }

    const fullQuestion = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { category: true },
    });

    const typeLabel = TYPE_LABELS[fullQuestion!.type] || fullQuestion!.type;
    let optionsHint = '';
    if (fullQuestion!.options) {
      try {
        optionsHint = `\n选项: ${fullQuestion!.options}`;
      } catch {
        /* ignore */
      }
    }

    const prompt = `请为以下${typeLabel}生成详细的解析说明:
题目: ${fullQuestion!.title}${optionsHint}
正确答案: ${fullQuestion!.answer}
难度: ${fullQuestion!.difficulty}/5

要求:
1. 解释为什么正确答案是这个
2. 如果有选项, 简要说明其他选项为什么不对
3. 解析要清晰易懂, 适合学生理解

请直接返回解析文本, 不要包含标题或其他格式。`;

    const analysis = await this.chat(prompt);

    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: { analysis },
      include: { category: true },
    });

    return updated;
  }

  /**
   * AI 翻译题目: 将主语言内容翻译为目标语言, 返回翻译草稿 (不写库)
   * 教师在前端修订后, 通过 PATCH /questions/:id 的 translations 字段保存
   */
  async translateQuestion(
    questionId: string,
    dto: TranslateQuestionDto,
    userId: string,
    role: string,
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        question.bankId,
        'editor',
      );
    }

    const sourceLocale = normalizeLocale(question.locale);
    const targetLocale = normalizeLocale(dto.targetLocale);

    if (targetLocale === sourceLocale) {
      throw new BadRequestException('目标语言不能与主语言相同');
    }

    const sourceLabel = sourceLocale === 'zh' ? '中文' : 'English';
    const targetLabel = targetLocale === 'zh' ? '中文' : 'English';

    // 解析主语言选项 (单选/多选/判断题)
    let options: object | null = null;
    if (question.options) {
      try {
        const parsed: unknown = JSON.parse(question.options);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          options = parsed;
        }
      } catch {
        /* ignore malformed options */
      }
    }

    const typeLabel = TYPE_LABELS[question.type] || question.type;
    const langName = targetLocale === 'zh' ? '中文' : '英语';

    const prompt = `请将以下${sourceLabel}考试题目翻译为${targetLabel}, 保持题意与专业性不变, 不要增删选项数量或改变答案。

题型: ${typeLabel}
题目标题: ${question.title}
${options ? `选项: ${JSON.stringify(options)}` : ''}
答案: ${question.answer}
${question.analysis ? `解析: ${question.analysis}` : ''}

要求:
1. 翻译准确自然, 符合${langName}表达习惯
2. 选项 (如有) 用 JSON 对象格式, 形如 {"A":"...","B":"..."}, key 必须与原文一致
3. 答案为字母 (单选/多选/判断题) 时保持原字母不变; 其余题型翻译答案文本
4. 解析可选

请严格按以下 JSON 格式返回, 不要包含 markdown 代码块或其他文字:
{
  "title": "翻译后的标题",
  ${options ? '"options": {"A":"...","B":"..."},' : ''}
  "answer": "翻译后的答案",
  "analysis": "翻译后的解析"
}`;

    const content = await this.chat(prompt);

    let translation: AiQuestionDraft | null;
    try {
      const jsonStr = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      translation = JSON.parse(jsonStr) as typeof translation;
    } catch {
      throw new BadRequestException('AI 返回格式异常, 请重试');
    }

    if (!translation || !translation.title) {
      throw new BadRequestException('AI 返回格式异常, 请重试');
    }

    return {
      sourceLocale,
      targetLocale,
      translation: {
        title: String(translation.title),
        ...(translation.options !== undefined && {
          options: translation.options,
        }),
        ...(translation.answer !== undefined && {
          answer: String(translation.answer),
        }),
        ...(translation.analysis !== undefined && {
          analysis: String(translation.analysis),
        }),
      },
    };
  }

  async rulePaperCompose(dto: RulePaperDto, userId: string, role: string) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, dto.bankId, 'editor');
    }
    const { name, duration, totalScore, rules, bankId } = dto;
    const selectedIds: string[] = [];

    for (const rule of rules) {
      const where: Prisma.QuestionWhereInput = { bankId };
      if (rule.categoryId) where.categoryId = rule.categoryId;
      if (rule.type) where.type = rule.type;
      if (rule.difficulty) where.difficulty = rule.difficulty;

      const candidates = await this.prisma.question.findMany({
        where,
        select: { id: true },
      });

      const shuffled = candidates.sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, rule.count);

      if (picked.length < rule.count) {
        throw new BadRequestException(
          `规则不满足: 需要 ${rule.count} 题, 但只有 ${picked.length} 题可用`,
        );
      }

      selectedIds.push(...picked.map((q) => q.id));
    }

    const questions = await this.prisma.question.findMany({
      where: { id: { in: selectedIds } },
    });

    const actualTotal = questions.reduce((sum, q) => sum + q.score, 0);
    if (actualTotal !== totalScore) {
      throw new BadRequestException(
        `所选题目总分为 ${actualTotal}, 与目标总分 ${totalScore} 不一致`,
      );
    }

    const paper = await this.prisma.paper.create({
      data: {
        name,
        duration,
        totalScore: actualTotal,
        bankId,
        questions: {
          create: selectedIds.map((questionId, index) => ({
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

    return paper;
  }

  async aiPaperCompose(dto: AiPaperDto, userId: string, role: string) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, dto.bankId, 'editor');
    }
    const {
      name,
      duration,
      totalScore,
      subject,
      difficultyPreference,
      categoryId,
      bankId,
    } = dto;

    const where: Prisma.QuestionWhereInput = { bankId };
    if (categoryId) where.categoryId = categoryId;

    const candidates = await this.prisma.question.findMany({
      where,
      include: { category: true },
    });

    if (candidates.length === 0) {
      throw new BadRequestException('题库中没有可用的题目');
    }

    const pool = candidates.slice(0, 100);
    const candidateList = pool.map((q) => ({
      id: q.id,
      title: q.title.substring(0, 60),
      type: TYPE_LABELS[q.type],
      difficulty: q.difficulty,
      score: q.score,
      category: q.category?.name || '',
    }));

    const prompt = `我需要从题库中选出题目组成一份试卷。

试卷要求:
- 科目/主题: ${subject}
- 总分: ${totalScore}
- 难度偏好: ${difficultyPreference || '适中'}

候选题目 (JSON数组):
${JSON.stringify(candidateList)}

请从候选题目中选出一组题目, 使得总分恰好等于 ${totalScore} 分.
返回选中的题目 ID 数组, 格式如下 (不要包含 markdown 代码块):
["id1", "id2", "id3"]`;

    const content = await this.chat(prompt);

    let selectedIds: unknown;
    try {
      const jsonStr = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      selectedIds = JSON.parse(jsonStr);
    } catch {
      throw new BadRequestException('AI 返回格式异常, 请重试');
    }

    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      throw new BadRequestException('AI 未选出任何题目, 请重试');
    }

    const validIds = selectedIds.filter((id: unknown): id is string =>
      candidates.some((c) => c.id === id),
    );

    if (validIds.length !== selectedIds.length) {
      throw new BadRequestException('AI 选出了无效的题目, 请重试');
    }

    const paper = await this.prisma.paper.create({
      data: {
        name,
        duration,
        totalScore,
        bankId,
        questions: {
          create: validIds.map((questionId: string, index: number) => ({
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

    return paper;
  }
}
