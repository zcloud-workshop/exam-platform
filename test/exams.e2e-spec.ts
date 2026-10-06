import type { Exam } from '@prisma/client';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createQuestion,
  createUserWithId,
} from './test-utils';

type ExamResponse = Pick<Exam, 'id' | 'name'> & {
  paper: { name: string; questions: { questionId: string }[] };
};

describe('考试模块 (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let paperId: string;
  let examId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');

    const questionId = await createQuestion(ctx, adminToken, { title: 'test' });
    const pRes = await ctx
      .req()
      .post('/api/papers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'test paper',
        duration: 60,
        totalScore: 100,
        bankId: ctx.bankId,
        questionIds: [questionId],
      });
    paperId = responseData<{ id: string }>(pRes).id;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 创建 ===

  it('结束时间早于开始时间返回 400', () => {
    return ctx
      .req()
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'bad exam',
        paperId,
        startTime: '2030-12-31T23:00:00Z',
        endTime: '2030-01-01T00:00:00Z',
      })
      .expect(400);
  });

  it('创建考试', () => {
    return ctx
      .req()
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '期末考试-第一场',
        paperId,
        startTime: '2020-01-01T00:00:00Z',
        endTime: '2030-12-31T23:59:59Z',
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<ExamResponse>(res);
        expect(data.name).toBe('期末考试-第一场');
        expect(data.paper.name).toBe('test paper');
        examId = data.id;
      });
  });

  // === 查询 ===

  it('获取考试列表', () => {
    return ctx
      .req()
      .get('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<{ total: number }>(res);
        expect(data.total).toBeGreaterThanOrEqual(1);
      });
  });

  it('获取考试详情', () => {
    return ctx
      .req()
      .get(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<ExamResponse>(res);
        expect(data.paper.questions.length).toBe(1);
      });
  });

  // === 更新 ===

  it('更新考试', () => {
    return ctx
      .req()
      .patch(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '期末考试-第二场' })
      .expect(200)
      .expect((res) => {
        const data = responseData<ExamResponse>(res);
        expect(data.name).toBe('期末考试-第二场');
      });
  });

  // === 删除 ===

  it('有答题记录时拒绝删除', async () => {
    const student = await createUserWithId(
      ctx,
      adminToken,
      'student1',
      'student',
    );
    await ctx
      .req()
      .patch(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ studentIds: [student.id] });

    const exam = await ctx
      .req()
      .get(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const questionId =
      responseData<ExamResponse>(exam).paper.questions[0].questionId;

    await ctx
      .req()
      .post(`/api/exams/${examId}/records`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ answers: { [questionId]: 'A' } });

    return ctx
      .req()
      .delete(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
