import type { PaginatedResult } from '../src/common/types/pagination';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUserWithId,
} from './test-utils';

type PracticeQuestion = {
  id: string;
  title: string;
  options: unknown;
  translations: Record<string, { title?: string; options?: unknown }> | null;
  isFavorite: boolean;
  isWrong: boolean;
  index?: number;
};
type PracticeSummary = {
  wrongCount: number;
  favoriteCount: number;
  attemptCount: number;
  correctCount: number;
  gradedCount: number;
};
type PracticeQuestionPage = PaginatedResult<PracticeQuestion> & {
  questionTotal: number;
  practiceTotal: number;
  matchingIndexes?: number[];
  seed: string;
  initialIndex: number;
};
type MyQuestion = {
  question: PracticeQuestion;
  bank: { id: string; name: string };
  attemptCount: number;
  wrongCount: number;
  lastAttemptAt: string | null;
};
type PracticeRecord = {
  id: string;
  userAnswer: string;
  correct: boolean | null;
  answer: string;
  analysis: string | null;
  createdAt: string;
  question: PracticeQuestion;
  bank: { id: string; name: string };
};
type CheckResult = {
  correct: boolean;
  graded: boolean;
  answer: string;
  analysis: string | null;
};

describe('Practice (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let student: { id: string; token: string };
  let otherStudent: { id: string; token: string };
  let secondBankId: string;
  let privateBankId: string;
  let secondQuestionId: string;
  let privateQuestionId: string;
  const questionIds = Array.from(
    { length: 60 },
    (_, index) => `practice-question-${String(index + 1).padStart(2, '0')}`,
  );

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
    student = await createUserWithId(ctx, adminToken, 'practice1', 'student');
    otherStudent = await createUserWithId(
      ctx,
      adminToken,
      'practice2',
      'student',
    );
    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const secondBank = await ctx.prisma.questionBank.create({
      data: {
        name: '第二公开题库',
        isPublic: true,
        createdBy: admin.id,
      },
    });
    secondBankId = secondBank.id;
    const privateBank = await ctx.prisma.questionBank.create({
      data: { name: '私有题库', createdBy: admin.id },
    });
    privateBankId = privateBank.id;
    await ctx.prisma.question.createMany({
      data: questionIds.map((id, index) => ({
        id,
        bankId: ctx.bankId,
        title: `Question #${index + 1} 练习题`,
        type:
          index === 2
            ? 'multiple'
            : index === 3
              ? 'short'
              : index === 4
                ? 'program'
                : 'single',
        options: JSON.stringify({ A: '正确选项', B: '错误选项' }),
        answer: index === 2 ? 'A,B' : 'A',
        analysis: '仅核对后可见的解析',
        translations:
          index === 0
            ? JSON.stringify({
                en: {
                  title: 'Cloud durability',
                  options: JSON.stringify({
                    A: 'Replicated storage',
                    B: 'Disk',
                  }),
                  answer: 'A',
                  analysis: 'Hidden translated explanation',
                },
              })
            : null,
      })),
    });
    const secondQuestion = await ctx.prisma.question.create({
      data: {
        title: '其他题库的题目',
        type: 'single',
        answer: 'A',
        bankId: secondBankId,
      },
    });
    secondQuestionId = secondQuestion.id;
    const privateQuestion = await ctx.prisma.question.create({
      data: {
        title: '私有题库的题目',
        type: 'single',
        answer: 'A',
        bankId: privateBankId,
      },
    });
    privateQuestionId = privateQuestion.id;
  });

  beforeEach(async () => {
    await ctx.prisma.practiceAttempt.deleteMany();
    await ctx.prisma.userPracticeQuestion.deleteMany();
    await ctx.prisma.questionBank.updateMany({
      where: { id: { in: [ctx.bankId, secondBankId] } },
      data: { isPublic: true },
    });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  function questionPath(questionId: string, bankId = ctx.bankId) {
    return `/api/practice/banks/${bankId}/questions/${questionId}`;
  }

  function check(
    questionId: string,
    userAnswer: string,
    token = student.token,
    bankId = ctx.bankId,
  ) {
    return ctx
      .req()
      .post(`${questionPath(questionId, bankId)}/check`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userAnswer });
  }

  function favorite(
    questionId: string,
    token = student.token,
    bankId = ctx.bankId,
  ) {
    return ctx
      .req()
      .put(`${questionPath(questionId, bankId)}/favorite`)
      .set('Authorization', `Bearer ${token}`);
  }

  function expectSafeQuestion(question: PracticeQuestion) {
    expect(question).not.toHaveProperty('answer');
    expect(question).not.toHaveProperty('analysis');
    for (const translation of Object.values(question.translations ?? {})) {
      expect(translation).not.toHaveProperty('answer');
      expect(translation).not.toHaveProperty('analysis');
    }
  }

  it('个人查询和修改都要求登录, 集合练习不允许匿名访问', async () => {
    await ctx.req().get('/api/practice/mine/summary').expect(401);
    await ctx
      .req()
      .get('/api/practice/mine/questions?collection=wrong')
      .expect(401);
    await ctx.req().get('/api/practice/mine/records').expect(401);
    await ctx
      .req()
      .put(`${questionPath(questionIds[0])}/favorite`)
      .expect(401);
    await ctx
      .req()
      .delete(`${questionPath(questionIds[0])}/favorite`)
      .expect(401);
    await ctx
      .req()
      .delete(`/api/practice/mine/wrong-questions/${questionIds[0]}`)
      .expect(401);
    for (const collection of ['wrong', 'favorites']) {
      await ctx
        .req()
        .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
        .query({ collection })
        .expect(401);
    }
    await ctx
      .req()
      .get('/api/practice/mine/summary')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('匿名核对不保存记录, 保留前 50 题和随机练习限制', async () => {
    const result = await ctx
      .req()
      .post(`${questionPath(questionIds[0])}/check`)
      .send({ userAnswer: 'B' })
      .expect(201);
    expect(responseData<CheckResult>(result)).toMatchObject({
      correct: false,
      graded: true,
      answer: 'A',
    });
    expect(await ctx.prisma.practiceAttempt.count()).toBe(0);
    expect(await ctx.prisma.userPracticeQuestion.count()).toBe(0);
    const page = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
      .expect(200);
    const data = responseData<PracticeQuestionPage>(page);
    expect(data).toMatchObject({
      total: 50,
      questionTotal: 60,
      practiceTotal: 50,
    });
    expect(data.data).toHaveLength(50);
    expect(
      data.data.every((question) => !question.isFavorite && !question.isWrong),
    ).toBe(true);
    await ctx.req().get(questionPath(questionIds[50])).expect(403);
    await ctx
      .req()
      .post(`${questionPath(questionIds[50])}/check`)
      .send({ userAnswer: 'A' })
      .expect(403);
    await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages?mode=random`)
      .expect(403);
  });

  it('重复收藏保持幂等, 取消收藏保留错题和历史', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await favorite(questionIds[0]).expect(200);
      expect(responseData<{ isFavorite: boolean }>(result).isFavorite).toBe(
        true,
      );
    }
    await check(questionIds[0], 'B').expect(201);
    const favorites = await ctx
      .req()
      .get('/api/practice/mine/questions?collection=favorites')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const data = responseData<PaginatedResult<MyQuestion>>(favorites);
    expect(data.total).toBe(1);
    expect(data.data[0]).toMatchObject({
      question: { id: questionIds[0], isFavorite: true, isWrong: true },
      bank: { id: ctx.bankId },
      attemptCount: 1,
      wrongCount: 1,
    });
    expect(data.data[0].lastAttemptAt).toEqual(expect.any(String));
    expect(await ctx.prisma.userPracticeQuestion.count()).toBe(1);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await ctx
        .req()
        .delete(`${questionPath(questionIds[0])}/favorite`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      expect(responseData<{ isFavorite: boolean }>(result).isFavorite).toBe(
        false,
      );
    }
    const detail = await ctx
      .req()
      .get(questionPath(questionIds[0]))
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(responseData<PracticeQuestion>(detail)).toMatchObject({
      isFavorite: false,
      isWrong: true,
    });
    expect(await ctx.prisma.practiceAttempt.count()).toBe(1);
  });

  it('客观题答错加入错题, 答对移出并保留每次核对记录', async () => {
    const wrong = await check(questionIds[0], ' B ').expect(201);
    expect(responseData<CheckResult>(wrong)).toMatchObject({
      correct: false,
      graded: true,
    });
    const wrongQuestions = await ctx
      .req()
      .get('/api/practice/mine/questions?collection=wrong')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(
      responseData<PaginatedResult<MyQuestion>>(wrongQuestions).total,
    ).toBe(1);
    const correct = await check(questionIds[0], ' A ').expect(201);
    expect(responseData<CheckResult>(correct)).toMatchObject({
      correct: true,
      graded: true,
    });
    const summary = await ctx
      .req()
      .get('/api/practice/mine/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(responseData<PracticeSummary>(summary)).toEqual({
      wrongCount: 0,
      favoriteCount: 0,
      attemptCount: 2,
      correctCount: 1,
      gradedCount: 2,
    });
    const records = await ctx
      .req()
      .get('/api/practice/mine/records?page=1&pageSize=1')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const data = responseData<PaginatedResult<PracticeRecord>>(records);
    expect(data).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(data.data).toHaveLength(1);
    expect(data.data[0]).toMatchObject({
      userAnswer: ' A ',
      correct: true,
      answer: 'A',
      analysis: '仅核对后可见的解析',
      question: { id: questionIds[0], isWrong: false },
      bank: { id: ctx.bankId },
    });
    expect(data.data[0].createdAt).toEqual(expect.any(String));
    expectSafeQuestion(data.data[0].question);
    const earlierRecords = await ctx
      .req()
      .get('/api/practice/mine/records?page=2&pageSize=1')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(
      responseData<PaginatedResult<PracticeRecord>>(earlierRecords).data[0],
    ).toMatchObject({ userAnswer: ' B ', correct: false });
    expect(await ctx.prisma.record.count()).toBe(0);
  });

  it('多选核对忽略选项顺序, 主观题不计入错题和正确率分母', async () => {
    const multiple = await check(questionIds[2], ' B, A ').expect(201);
    expect(responseData<CheckResult>(multiple)).toMatchObject({
      correct: true,
      graded: true,
    });
    for (const questionId of [questionIds[3], questionIds[4]]) {
      const subjective = await check(questionId, '自己的回答').expect(201);
      expect(responseData<CheckResult>(subjective)).toMatchObject({
        correct: false,
        graded: false,
        answer: 'A',
      });
    }
    const summary = await ctx
      .req()
      .get('/api/practice/mine/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(responseData<PracticeSummary>(summary)).toEqual({
      wrongCount: 0,
      favoriteCount: 0,
      attemptCount: 3,
      correctCount: 1,
      gradedCount: 1,
    });
    const records = await ctx
      .req()
      .get('/api/practice/mine/records')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const data = responseData<PaginatedResult<PracticeRecord>>(records);
    expect(data.data.filter((record) => record.correct === null)).toHaveLength(
      2,
    );
  });

  it('手动移出错题保留收藏和练习记录', async () => {
    await favorite(questionIds[0]).expect(200);
    await check(questionIds[0], 'B').expect(201);
    for (let attempt = 0; attempt < 2; attempt++) {
      const removed = await ctx
        .req()
        .delete(`/api/practice/mine/wrong-questions/${questionIds[0]}`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      expect(responseData<{ success: boolean }>(removed)).toEqual({
        success: true,
      });
    }
    const summary = await ctx
      .req()
      .get('/api/practice/mine/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(responseData<PracticeSummary>(summary)).toMatchObject({
      wrongCount: 0,
      favoriteCount: 1,
      attemptCount: 1,
    });
    await check(questionIds[0], 'B').expect(201);
    const wrongQuestions = await ctx
      .req()
      .get('/api/practice/mine/questions?collection=wrong')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(
      responseData<PaginatedResult<MyQuestion>>(wrongQuestions).data[0],
    ).toMatchObject({ attemptCount: 2, wrongCount: 2 });
  });

  it('各账号的收藏, 错题和历史隔离, 查询不接受客户端 userId', async () => {
    await favorite(questionIds[0]).expect(200);
    await check(questionIds[0], 'B').expect(201);
    await check(questionIds[0], 'A', otherStudent.token).expect(201);
    const otherSummary = await ctx
      .req()
      .get('/api/practice/mine/summary')
      .set('Authorization', `Bearer ${otherStudent.token}`)
      .expect(200);
    expect(responseData<PracticeSummary>(otherSummary)).toEqual({
      wrongCount: 0,
      favoriteCount: 0,
      attemptCount: 1,
      correctCount: 1,
      gradedCount: 1,
    });
    const otherRecords = await ctx
      .req()
      .get('/api/practice/mine/records')
      .set('Authorization', `Bearer ${otherStudent.token}`)
      .expect(200);
    expect(
      responseData<PaginatedResult<PracticeRecord>>(otherRecords).data,
    ).toHaveLength(1);
    expect(
      responseData<PaginatedResult<PracticeRecord>>(otherRecords).data[0],
    ).toMatchObject({
      userAnswer: 'A',
      question: { isFavorite: false, isWrong: false },
    });
    const ownDetail = await ctx
      .req()
      .get(questionPath(questionIds[0]))
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(responseData<PracticeQuestion>(ownDetail)).toMatchObject({
      isFavorite: true,
      isWrong: true,
    });
    await ctx
      .req()
      .get('/api/practice/mine/records')
      .query({ userId: student.id })
      .set('Authorization', `Bearer ${otherStudent.token}`)
      .expect(400);
    await ctx
      .req()
      .post(`${questionPath(questionIds[0])}/check`)
      .set('Authorization', `Bearer ${otherStudent.token}`)
      .send({ userAnswer: 'A', userId: student.id })
      .expect(400);
  });

  it('个人集合先过滤再分页和搜索, 随机顺序使用固定种子', async () => {
    for (const questionId of [
      questionIds[0],
      questionIds[1],
      questionIds[59],
    ]) {
      await favorite(questionId).expect(200);
      await check(questionId, 'B').expect(201);
    }
    const sequential = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
      .query({ collection: 'favorites', page: 2, pageSize: 1 })
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const sequentialData = responseData<PracticeQuestionPage>(sequential);
    expect(sequentialData).toMatchObject({
      total: 3,
      practiceTotal: 3,
      questionTotal: 3,
    });
    expect(sequentialData.data[0]).toMatchObject({
      id: questionIds[1],
      index: 1,
    });
    const search = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
      .query({ collection: 'wrong', keyword: ' REPLICATED ' })
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const searchData = responseData<PracticeQuestionPage>(search);
    expect(searchData).toMatchObject({
      total: 1,
      practiceTotal: 3,
      matchingIndexes: [0],
    });
    expect(searchData.data[0]).toMatchObject({ id: questionIds[0], index: 0 });
    const randomPages: PracticeQuestion[] = [];
    for (const page of [1, 2, 3]) {
      const result = await ctx
        .req()
        .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
        .query({
          collection: 'wrong',
          mode: 'random',
          seed: 'review-session',
          page,
          pageSize: 1,
        })
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      randomPages.push(...responseData<PracticeQuestionPage>(result).data);
    }
    expect(randomPages.map((question) => question.id).sort()).toEqual(
      [questionIds[0], questionIds[1], questionIds[59]].sort(),
    );
    expect(randomPages.map((question) => question.index)).toEqual([0, 1, 2]);
    const repeated = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
      .query({
        collection: 'wrong',
        mode: 'random',
        seed: 'review-session',
        pageSize: 3,
      })
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(
      responseData<PracticeQuestionPage>(repeated).data.map(
        (question) => question.id,
      ),
    ).toEqual(randomPages.map((question) => question.id));
  });

  it('收藏, 错题和历史支持按题库筛选和独立分页', async () => {
    await favorite(questionIds[0]).expect(200);
    await favorite(secondQuestionId, student.token, secondBankId).expect(200);
    await check(questionIds[0], 'B').expect(201);
    await check(secondQuestionId, 'B', student.token, secondBankId).expect(201);
    for (const collection of ['favorites', 'wrong']) {
      const result = await ctx
        .req()
        .get('/api/practice/mine/questions')
        .query({ collection, bankId: secondBankId, page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const data = responseData<PaginatedResult<MyQuestion>>(result);
      expect(data).toMatchObject({ total: 1, page: 1, pageSize: 1 });
      expect(data.data[0]).toMatchObject({
        question: { id: secondQuestionId },
        bank: { id: secondBankId },
      });
    }
    const result = await ctx
      .req()
      .get('/api/practice/mine/records')
      .query({ bankId: ctx.bankId })
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const data = responseData<PaginatedResult<PracticeRecord>>(result);
    expect(data.total).toBe(1);
    expect(data.data[0].question.id).toBe(questionIds[0]);
  });

  it('指定题目定位到集合内的实际页码, 集合外题目返回 404', async () => {
    for (const questionId of [
      questionIds[0],
      questionIds[1],
      questionIds[59],
    ]) {
      await favorite(questionId).expect(200);
    }
    const result = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
      .query({
        collection: 'favorites',
        questionId: questionIds[59],
        page: 1,
        pageSize: 1,
      })
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const data = responseData<PracticeQuestionPage>(result);
    expect(data).toMatchObject({ page: 3, initialIndex: 2, practiceTotal: 3 });
    expect(data.data[0]).toMatchObject({ id: questionIds[59], index: 2 });
    for (const query of [
      { collection: 'favorites', questionId: questionIds[2] },
      {
        collection: 'favorites',
        questionId: questionIds[59],
        keyword: 'durability',
      },
    ]) {
      await ctx
        .req()
        .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
        .query(query)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(404);
    }
  });

  it('首次并发核对和收藏无创建竞争, 次数不丢失', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () =>
        check(questionIds[0], 'B').expect(201),
      ),
      ...Array.from({ length: 4 }, () => favorite(questionIds[0]).expect(200)),
    ]);
    expect(results).toHaveLength(8);
    const states = await ctx.prisma.userPracticeQuestion.findMany({
      where: { userId: student.id, questionId: questionIds[0] },
    });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      isFavorite: true,
      isWrong: true,
      attemptCount: 4,
      wrongCount: 4,
    });
    expect(
      await ctx.prisma.practiceAttempt.count({
        where: { userId: student.id, questionId: questionIds[0] },
      }),
    ).toBe(4);
  });

  it('所有练习题目响应删除主答案和翻译答案, 游客不会取得个人状态', async () => {
    await favorite(questionIds[0]).expect(200);
    await check(questionIds[0], 'B').expect(201);
    const list = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/questions`)
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    const first = responseData<PracticeQuestion[]>(list).find(
      (question) => question.id === questionIds[0],
    )!;
    expectSafeQuestion(first);
    expect(first.translations?.en.options).toEqual({
      A: 'Replicated storage',
      B: 'Disk',
    });
    expect(first).toMatchObject({ isFavorite: true, isWrong: true });
    const page = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/question-pages`)
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expectSafeQuestion(responseData<PracticeQuestionPage>(page).data[0]);
    const detail = await ctx
      .req()
      .get(questionPath(questionIds[0]))
      .expect(200);
    const guestQuestion = responseData<PracticeQuestion>(detail);
    expectSafeQuestion(guestQuestion);
    expect(guestQuestion).toMatchObject({ isFavorite: false, isWrong: false });
    const mine = await ctx
      .req()
      .get('/api/practice/mine/questions?collection=wrong')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expectSafeQuestion(
      responseData<PaginatedResult<MyQuestion>>(mine).data[0].question,
    );
  });

  it('关闭公开后个人汇总和列表隐藏该题库, 禁止核对和收藏', async () => {
    await favorite(questionIds[0]).expect(200);
    await check(questionIds[0], 'B').expect(201);
    await ctx.prisma.questionBank.update({
      where: { id: ctx.bankId },
      data: { isPublic: false },
    });
    const summary = await ctx
      .req()
      .get('/api/practice/mine/summary')
      .set('Authorization', `Bearer ${student.token}`)
      .expect(200);
    expect(responseData<PracticeSummary>(summary)).toEqual({
      wrongCount: 0,
      favoriteCount: 0,
      attemptCount: 0,
      correctCount: 0,
      gradedCount: 0,
    });
    for (const path of [
      '/api/practice/mine/questions?collection=wrong',
      '/api/practice/mine/questions?collection=favorites',
      '/api/practice/mine/records',
    ]) {
      const result = await ctx
        .req()
        .get(path)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      expect(
        responseData<PaginatedResult<MyQuestion | PracticeRecord>>(result),
      ).toMatchObject({ data: [], total: 0 });
    }
    await check(questionIds[0], 'A').expect(404);
    await favorite(questionIds[0]).expect(404);
    await favorite(privateQuestionId, student.token, privateBankId).expect(404);
    await check(privateQuestionId, 'A', student.token, privateBankId).expect(
      404,
    );
    expect(await ctx.prisma.practiceAttempt.count()).toBe(1);
    expect(await ctx.prisma.userPracticeQuestion.count()).toBe(1);
  });

  it('不允许跨题库核对和收藏, 拒绝非法集合和页码', async () => {
    await favorite(secondQuestionId).expect(404);
    await check(secondQuestionId, 'A').expect(404);
    for (const query of [
      { collection: 'invalid' },
      { collection: 'wrong', page: 0 },
      { collection: 'favorites', pageSize: 101 },
    ]) {
      await ctx
        .req()
        .get('/api/practice/mine/questions')
        .query(query)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(400);
    }
    await ctx
      .req()
      .get(
        `/api/practice/banks/${ctx.bankId}/question-pages?collection=invalid`,
      )
      .set('Authorization', `Bearer ${student.token}`)
      .expect(400);
    expect(await ctx.prisma.practiceAttempt.count()).toBe(0);
    expect(await ctx.prisma.userPracticeQuestion.count()).toBe(0);
  });

  it('删除无试卷引用的题目时级联清理收藏, 错题和练习历史', async () => {
    const question = await ctx.prisma.question.create({
      data: {
        title: '可删除的练习题',
        type: 'single',
        answer: 'A',
        bankId: ctx.bankId,
      },
    });
    await favorite(question.id).expect(200);
    await check(question.id, 'B').expect(201);
    await ctx
      .req()
      .delete(`/api/questions/${question.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      await ctx.prisma.userPracticeQuestion.count({
        where: { questionId: question.id },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.practiceAttempt.count({
        where: { questionId: question.id },
      }),
    ).toBe(0);
    await ctx
      .req()
      .get(questionPath(question.id))
      .set('Authorization', `Bearer ${student.token}`)
      .expect(404);
  });
});
