import type { Record as ExamRecord } from '@prisma/client';
import type { PaginatedResult } from '../src/common/types/pagination';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
  createUserWithId,
  setupExam,
} from './test-utils';

type RecordResponse = Pick<ExamRecord, 'status' | 'score'>;
type DraftResponse = { answers: Record<string, string> };
type RecordStats = { count: number; max: number; min: number; avg: number };

describe('Records (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let studentToken: string;
  let studentId: string;
  let teacherToken: string;
  let examId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');

    teacherToken = await createUser(ctx, adminToken, 'teacher1', 'teacher');
    const student = await createUserWithId(
      ctx,
      adminToken,
      'student1',
      'student',
    );
    studentId = student.id;
    studentToken = student.token;

    const exam = await setupExam(ctx, adminToken, {
      questionScore: 5,
      answer: '2',
      studentIds: [studentId],
    });
    questionId = exam.questionId;
    examId = exam.examId;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 草稿功能 ===

  it('保存草稿', () => {
    return ctx
      .req()
      .put(`/api/exams/${examId}/records/draft`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ answers: { [questionId]: '2' } })
      .expect(200)
      .expect((res) => {
        const data = responseData<RecordResponse>(res);
        expect(data.status).toBe('draft');
      });
  });

  it('更新已有草稿', () => {
    return ctx
      .req()
      .put(`/api/exams/${examId}/records/draft`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ answers: { [questionId]: '3' } })
      .expect(200)
      .expect((res) => {
        const data = responseData<RecordResponse>(res);
        expect(data.status).toBe('draft');
      });
  });

  it('获取草稿', () => {
    return ctx
      .req()
      .get(`/api/exams/${examId}/records/draft`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<DraftResponse>(res);
        expect(data.answers[questionId]).toBe('3');
      });
  });

  // === 提交与阅卷 ===

  it('草稿升级为已提交', () => {
    return ctx
      .req()
      .post(`/api/exams/${examId}/records`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ answers: { [questionId]: '2' } })
      .expect(201)
      .expect((res) => {
        const data = responseData<RecordResponse>(res);
        expect(data.status).toBe('submitted');
        expect(data.score).toBe(5);
      });
  });

  it('重复提交返回 400', () => {
    return ctx
      .req()
      .post(`/api/exams/${examId}/records`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ answers: { [questionId]: '1' } })
      .expect(400);
  });

  it('已提交后保存草稿返回 400', () => {
    return ctx
      .req()
      .put(`/api/exams/${examId}/records/draft`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ answers: { [questionId]: '1' } })
      .expect(400);
  });

  it('已提交后获取草稿返回 400', () => {
    return ctx
      .req()
      .get(`/api/exams/${examId}/records/draft`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(400);
  });

  // === 权限控制 ===

  it('非学生提交返回 403', async () => {
    const exam = await setupExam(ctx, adminToken);

    return ctx
      .req()
      .post(`/api/exams/${exam.examId}/records`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ answers: { [exam.questionId]: 'A' } })
      .expect(403);
  });

  it('无草稿时返回空对象', async () => {
    const student = await createUserWithId(
      ctx,
      adminToken,
      'student2',
      'student',
    );
    const exam = await setupExam(ctx, adminToken, { studentIds: [student.id] });

    return ctx
      .req()
      .get(`/api/exams/${exam.examId}/records/draft`)
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<DraftResponse>(res);
        expect(data.answers).toEqual({});
      });
  });

  it('无草稿直接提交', async () => {
    const student = await createUserWithId(
      ctx,
      adminToken,
      'student3',
      'student',
    );
    const exam = await setupExam(ctx, adminToken, {
      questionScore: 10,
      studentIds: [student.id],
    });

    return ctx
      .req()
      .post(`/api/exams/${exam.examId}/records`)
      .set('Authorization', `Bearer ${student.token}`)
      .send({ answers: { [exam.questionId]: 'A' } })
      .expect(201)
      .expect((res) => {
        const data = responseData<RecordResponse>(res);
        expect(data.status).toBe('submitted');
        expect(data.score).toBe(10);
      });
  });

  it('未分配学生无法提交', async () => {
    const exam = await setupExam(ctx, adminToken);

    return ctx
      .req()
      .post(`/api/exams/${exam.examId}/records`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ answers: { [exam.questionId]: 'A' } })
      .expect(400);
  });

  // === 教师查询 ===

  it('教师查看所有成绩', () => {
    return ctx
      .req()
      .get(`/api/exams/${examId}/records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data =
          responseData<PaginatedResult<{ user: { username: string } }>>(res);
        expect(data.total).toBe(1);
        expect(data.data[0].user.username).toBe('student1');
      });
  });

  it('成绩统计', () => {
    return ctx
      .req()
      .get(`/api/exams/${examId}/records/stats`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<RecordStats>(res);
        expect(data.count).toBe(1);
        expect(data.max).toBe(5);
        expect(data.min).toBe(5);
        expect(data.avg).toBe(5);
      });
  });
});
