import type { Paper, Question } from '@prisma/client';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
} from './test-utils';

type GeneratedQuestionsResponse = {
  count: number;
  questions: Pick<Question, 'title' | 'answer'>[];
};
type PaperResponse = Pick<Paper, 'name' | 'duration'> & {
  questions: unknown[];
};
type TranslationResponse = {
  sourceLocale: string;
  targetLocale: string;
  translation: { title: string };
};

describe('AI (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let questionId: string;
  let categoryId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
    teacherToken = await createUser(ctx, adminToken, 'teacher1', 'teacher');
    studentToken = await createUser(ctx, adminToken, 'student1', 'student');

    // Share bank with teacher as editor so they can use AI features
    const teacherUser = await ctx.prisma.user.findFirst({
      where: { username: 'teacher1' },
    });
    if (teacherUser) {
      await ctx.prisma.bankShare.create({
        data: { bankId: ctx.bankId, userId: teacherUser.id, role: 'editor' },
      });
    }

    const catRes = await ctx
      .req()
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '数学',
        bankId: ctx.bankId,
      });
    categoryId = responseData<{ id: string }>(catRes).id;

    const qRes = await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '1+1=?',
        type: 'single',
        options: ['1', '2', '3', '4'],
        answer: '2',
        difficulty: 1,
        score: 5,
        categoryId,
        bankId: ctx.bankId,
      });
    questionId = responseData<{ id: string }>(qRes).id;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === AI 出题 ===

  it('AI 自动出题', () => {
    return ctx
      .req()
      .post('/api/ai/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        topic: '二进制基础',
        type: 'single',
        count: 2,
        difficulty: 2,
        categoryId,
        bankId: ctx.bankId,
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<GeneratedQuestionsResponse>(res);
        expect(data.count).toBe(2);
        expect(data.questions).toHaveLength(2);
        expect(data.questions[0].title).toBeDefined();
        expect(data.questions[0].answer).toBeDefined();
      });
  }, 30000);

  it('teacher 也可出题', () => {
    return ctx
      .req()
      .post('/api/ai/questions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topic: '加法运算',
        type: 'fill',
        count: 1,
        bankId: ctx.bankId,
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<GeneratedQuestionsResponse>(res);
        expect(data.count).toBe(1);
      });
  }, 30000);

  // === AI 解析 ===

  it('AI 生成题目解析', () => {
    return ctx
      .req()
      .post(`/api/ai/analysis/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201)
      .expect((res) => {
        const data = responseData<{ analysis: string }>(res);
        expect(data.analysis).toBeDefined();
        expect(data.analysis.length).toBeGreaterThan(0);
      });
  }, 30000);

  it('题目不存在时生成解析返回 404', () => {
    return ctx
      .req()
      .post('/api/ai/analysis/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  // === AI 翻译 ===

  it('AI 翻译题目 (返回草稿, 不写库)', () => {
    return ctx
      .req()
      .post(`/api/ai/translate/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetLocale: 'en' })
      .expect(201)
      .expect((res) => {
        const data = responseData<TranslationResponse>(res);
        expect(data.sourceLocale).toBe('zh');
        expect(data.targetLocale).toBe('en');
        expect(data.translation.title).toBeDefined();
        expect(data.translation.title.length).toBeGreaterThan(0);
      });
  }, 30000);

  it('AI 翻译不写库 (题目 translations 保持原状)', async () => {
    const before = await ctx.prisma.question.findUnique({
      where: { id: questionId },
    });
    await ctx
      .req()
      .post(`/api/ai/translate/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetLocale: 'en' })
      .expect(201);
    const after = await ctx.prisma.question.findUnique({
      where: { id: questionId },
    });
    // 翻译只返回草稿, 不应改变数据库中的 translations 字段
    expect(after?.translations).toBe(before?.translations);
  }, 30000);

  it('AI 翻译目标语言与主语言相同时返回 400', () => {
    return ctx
      .req()
      .post(`/api/ai/translate/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetLocale: 'zh' })
      .expect(400);
  });

  it('teacher 也可翻译 (拥有 editor 权限)', () => {
    return ctx
      .req()
      .post(`/api/ai/translate/${questionId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ targetLocale: 'en' })
      .expect(201);
  }, 30000);

  it('student 无权使用 AI 翻译', () => {
    return ctx
      .req()
      .post(`/api/ai/translate/${questionId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ targetLocale: 'en' })
      .expect(403);
  });

  // === 规则组卷 ===

  it('规则组卷成功', async () => {
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '3+3=?',
        type: 'single',
        options: ['4', '5', '6', '7'],
        answer: '6',
        difficulty: 1,
        score: 5,
        categoryId,
        bankId: ctx.bankId,
      });
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '4+4=?',
        type: 'single',
        options: ['6', '7', '8', '9'],
        answer: '8',
        difficulty: 1,
        score: 5,
        categoryId,
        bankId: ctx.bankId,
      });

    return ctx
      .req()
      .post('/api/ai/smart-paper/rule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '规则组卷测试',
        duration: 60,
        totalScore: 15,
        bankId: ctx.bankId,
        rules: [
          {
            categoryId,
            type: 'single',
            difficulty: 1,
            count: 3,
            scorePerQuestion: 5,
          },
        ],
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<PaperResponse>(res);
        expect(data.name).toBe('规则组卷测试');
        expect(data.duration).toBe(60);
        expect(data.questions).toBeDefined();
        expect(data.questions.length).toBeGreaterThanOrEqual(1);
      });
  });

  it('规则组卷题目不足时返回 400', () => {
    return ctx
      .req()
      .post('/api/ai/smart-paper/rule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '不可满足的组卷',
        duration: 60,
        totalScore: 100,
        bankId: ctx.bankId,
        rules: [
          { type: 'program', difficulty: 5, count: 50, scorePerQuestion: 2 },
        ],
      })
      .expect(400);
  });

  // === AI 组卷 ===

  it('AI 智能组卷', () => {
    return ctx
      .req()
      .post('/api/ai/smart-paper/ai')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'AI组卷测试',
        duration: 60,
        totalScore: 10,
        bankId: ctx.bankId,
        subject: '数学基础',
        categoryId,
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<PaperResponse>(res);
        expect(data.name).toBe('AI组卷测试');
        expect(data.questions).toBeDefined();
        expect(data.questions.length).toBeGreaterThan(0);
      });
  }, 30000);

  // === 权限 ===

  it('student 无权使用 AI 出题', () => {
    return ctx
      .req()
      .post('/api/ai/questions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ topic: 'test', type: 'single', bankId: ctx.bankId })
      .expect(403);
  });

  it('student 无权使用 AI 组卷', () => {
    return ctx
      .req()
      .post('/api/ai/smart-paper/ai')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        name: 'x',
        duration: 60,
        totalScore: 10,
        subject: 'test',
        bankId: ctx.bankId,
      })
      .expect(403);
  });
});
