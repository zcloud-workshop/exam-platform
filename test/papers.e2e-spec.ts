import type { Paper, Question } from '@prisma/client';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createQuestion,
} from './test-utils';

type PaperResponse = Pick<Paper, 'id' | 'name' | 'duration'> & {
  questions: { questionId: string; question: Pick<Question, 'title'> }[];
};

describe('试卷模块 (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let questionId: string;
  let paperId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
    questionId = await createQuestion(ctx, adminToken, {
      title: 'test question',
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 创建 ===

  it('创建试卷', () => {
    return ctx
      .req()
      .post('/api/papers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '期末考试',
        duration: 120,
        totalScore: 100,
        bankId: ctx.bankId,
        questionIds: [questionId],
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<PaperResponse>(res);
        expect(data.name).toBe('期末考试');
        expect(data.questions.length).toBe(1);
        expect(data.questions[0].questionId).toBe(questionId);
        paperId = data.id;
      });
  });

  // === 查询 ===

  it('获取试卷列表', () => {
    return ctx
      .req()
      .get('/api/papers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<{ total: number }>(res);
        expect(data.total).toBeGreaterThanOrEqual(1);
      });
  });

  it('获取试卷详情', () => {
    return ctx
      .req()
      .get(`/api/papers/${paperId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<PaperResponse>(res);
        expect(data.questions[0].question.title).toBe('test question');
      });
  });

  // === 更新 ===

  it('更新试卷', () => {
    return ctx
      .req()
      .patch(`/api/papers/${paperId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '期中考试', duration: 90 })
      .expect(200)
      .expect((res) => {
        const data = responseData<PaperResponse>(res);
        expect(data.name).toBe('期中考试');
        expect(data.duration).toBe(90);
      });
  });

  // === 删除 ===

  it('被考试引用时拒绝删除', async () => {
    await ctx
      .req()
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'test exam',
        paperId,
        startTime: '2030-01-01T00:00:00Z',
        endTime: '2030-01-01T02:00:00Z',
      });

    return ctx
      .req()
      .delete(`/api/papers/${paperId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
