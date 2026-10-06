import type { Question } from '@prisma/client';
import type { PaginatedResult } from '../src/common/types/pagination';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
} from './test-utils';

type QuestionResponse = Pick<
  Question,
  'id' | 'title' | 'type' | 'locale' | 'score'
> & {
  options: unknown;
  translations: unknown;
};

describe('Questions (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let teacherToken: string;
  let questionId: string;
  let i18nQuestionId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
    teacherToken = await createUser(ctx, adminToken, 'teacher1', 'teacher');
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 创建 ===

  it('创建单选题', () => {
    return ctx
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
        bankId: ctx.bankId,
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.title).toBe('1+1=?');
        expect(data.type).toBe('single');
        expect(data.locale).toBe('zh');
        questionId = data.id;
      });
  });

  it('创建简答题', () => {
    return ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'What is HTML?',
        type: 'short',
        answer: 'HyperText Markup Language',
        score: 10,
        bankId: ctx.bankId,
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.options).toBeNull();
      });
  });

  // === 多语言 ===

  it('创建带英文翻译的题目', () => {
    return ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '1+1等于几?',
        type: 'single',
        options: ['1', '2', '3', '4'],
        answer: '2',
        score: 5,
        locale: 'zh',
        bankId: ctx.bankId,
        translations: {
          en: {
            title: 'What is 1+1?',
            options: ['1', '2', '3', '4'],
            answer: '2',
          },
        },
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.locale).toBe('zh');
        expect(data.translations).toBeDefined();
        i18nQuestionId = data.id;
      });
  });

  it('按 locale 获取英文版题目', () => {
    return ctx
      .req()
      .get(`/api/questions/${i18nQuestionId}?locale=en`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.title).toBe('What is 1+1?');
        expect(data.options).toEqual(['1', '2', '3', '4']);
      });
  });

  it('缺失翻译时回退到主语言', () => {
    return ctx
      .req()
      .get(`/api/questions/${i18nQuestionId}?locale=ja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.title).toBe('1+1等于几?');
      });
  });

  it('列表按 locale 返回翻译内容', () => {
    return ctx
      .req()
      .get(`/api/questions?locale=en&pageSize=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<PaginatedResult<QuestionResponse>>(res);
        const i18nQ = data.data.find((q) => q.id === i18nQuestionId);
        expect(i18nQ).toBeDefined();
        expect(i18nQ?.title).toBe('What is 1+1?');
      });
  });

  it('更新翻译', () => {
    return ctx
      .req()
      .patch(`/api/questions/${i18nQuestionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        translations: {
          en: {
            title: 'What is 1+1?',
            options: ['1', '2', '3', '4'],
            answer: '2',
            analysis: 'Basic addition',
          },
        },
      })
      .expect(200);
  });

  // === 查询 ===

  it('列表筛选和分页', () => {
    return ctx
      .req()
      .get('/api/questions?type=single&page=1&pageSize=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<PaginatedResult<QuestionResponse>>(res);
        expect(data.total).toBeGreaterThanOrEqual(1);
        expect(data.data[0].type).toBe('single');
      });
  });

  it('详情 (options 反序列化)', () => {
    return ctx
      .req()
      .get(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.options).toEqual(['1', '2', '3', '4']);
      });
  });

  // === 更新 ===

  it('更新题目', () => {
    return ctx
      .req()
      .patch(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ score: 10 })
      .expect(200)
      .expect((res) => {
        const data = responseData<QuestionResponse>(res);
        expect(data.score).toBe(10);
      });
  });

  // === 权限 ===

  it('teacher 无权限删除', () => {
    return ctx
      .req()
      .delete(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });

  // === 删除 ===

  it('admin 删除成功', () => {
    return ctx
      .req()
      .delete(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
