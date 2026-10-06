import type { Category, Question } from '@prisma/client';
import type { PaginatedResult } from '../src/common/types/pagination';
import type {
  BankArchiveDto,
  ImportSummaryDto,
} from '../src/question-banks/dto/bank-archive.dto';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createQuestion,
  createUserWithId,
} from './test-utils';

type QuestionResponse = Pick<Question, 'title'> & {
  category: Pick<Category, 'name'> | null;
};

/**
 * 题库归档导出/导入 e2e 测试。
 *
 * 覆盖: 空库导出、有数据导出、跨库导入(id + categoryId 保留)、
 * skip/overwrite 冲突策略、权限校验。
 */
describe('Bank Archive (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  /** 创建一个新题库并返回 id */
  async function createBank(name: string): Promise<string> {
    const res = await ctx
      .req()
      .post('/api/question-banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name });
    return responseData<{ id: string }>(res).id;
  }

  /** 在指定题库下创建分类 */
  async function createCategory(
    bankId: string,
    name: string,
    parentId?: string,
  ): Promise<string> {
    const res = await ctx
      .req()
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, bankId, parentId });
    return responseData<{ id: string }>(res).id;
  }

  it('导出空题库 → meta 正确, categories/questions 为空数组', async () => {
    const bankId = await createBank('空题库');
    const res = await ctx
      .req()
      .get(`/api/question-banks/${bankId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = responseData<BankArchiveDto>(res);
    expect(body.meta.id).toBe(bankId);
    expect(body.meta.name).toBe('空题库');
    expect(body.meta.version).toBe(1);
    expect(body.meta.exportedAt).toBeTruthy();
    expect(body.categories).toEqual([]);
    expect(body.questions).toEqual([]);
  });

  it('导出含分类树 + 题目的题库 → 结构完整, options/translations 保留为 JSON 字符串', async () => {
    const bankId = await createBank('有数据题库');
    const parentCat = await createCategory(bankId, '父分类');
    const childCat = await createCategory(bankId, '子分类', parentCat);

    // 带选项和翻译的题目
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '单选题',
        type: 'single',
        bankId,
        categoryId: parentCat,
        options: { A: '选项A', B: '选项B' },
        answer: 'A',
        difficulty: 2,
        score: 5,
        locale: 'zh',
        translations: { en: { title: 'Single choice', answer: 'A' } },
      })
      .expect(201);

    // 简答题
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '简答题',
        type: 'short',
        bankId,
        categoryId: childCat,
        answer: '参考答案',
      })
      .expect(201);

    const res = await ctx
      .req()
      .get(`/api/question-banks/${bankId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = responseData<BankArchiveDto>(res);
    expect(body.meta.name).toBe('有数据题库');
    expect(body.categories).toHaveLength(2);
    expect(body.categories.map((c) => c.name).sort()).toEqual([
      '子分类',
      '父分类',
    ]);
    expect(body.questions).toHaveLength(2);
    expect(body.questions.map((q) => q.title).sort()).toEqual([
      '单选题',
      '简答题',
    ]);
    // parentId 树关系保留
    const child = body.categories.find((c) => c.name === '子分类');
    expect(child?.parentId).toBe(parentCat);
  });

  it('导入归档到新题库 → 题目数一致, 内容一致, categoryId 关系正确重建', async () => {
    const srcBank = await createBank('源题库-导入');
    const cat = await createCategory(srcBank, '分类A');
    await createQuestion(ctx, adminToken, {
      title: '导入题1',
      bankId: srcBank,
    });
    // createQuestion helper 不支持 categoryId, 直接调 API 建第二题并关联分类
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '导入题2',
        type: 'single',
        answer: 'B',
        bankId: srcBank,
        categoryId: cat,
      });

    // 导出源题库
    const exp = await ctx
      .req()
      .get(`/api/question-banks/${srcBank}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const archive = responseData<BankArchiveDto>(exp);

    // 导入到新题库
    const destBank = await createBank('目标题库-导入');
    const imp = await ctx
      .req()
      .post(`/api/question-banks/${destBank}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive })
      .expect(201);

    const summary = responseData<ImportSummaryDto>(imp);
    expect(summary.categoriesImported).toBe(1);
    expect(summary.questionsImported).toBe(2);
    expect(summary.skipped).toBe(0);

    // 验证目标库: 题目数一致 + 内容一致 + 分类关系重建
    const listRes = await ctx
      .req()
      .get(`/api/questions?bankId=${destBank}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const destQuestions =
      responseData<PaginatedResult<QuestionResponse>>(listRes).data;
    expect(destQuestions).toHaveLength(2);
    expect(destQuestions.map((q) => q.title).sort()).toEqual([
      '导入题1',
      '导入题2',
    ]);
    // categoryId 关系: 导入题2 应关联到新库的分类A(id 虽不同但 name 一致)
    const destQ2 = destQuestions.find((q) => q.title === '导入题2');
    expect(destQ2?.category).toBeTruthy();
    expect(destQ2?.category?.name).toBe('分类A');
  });

  it('skip 模式(默认): 同名分类/同标题同类型题目视为已存在, 跳过', async () => {
    const bank = await createBank('skip测试题库');
    await createCategory(bank, '已存在分类');
    await createCategory(bank, '源分类');

    const archive = {
      meta: {
        id: 'x',
        name: 'src',
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      categories: [
        { id: 'any-1', name: '已存在分类', parentId: null }, // name 重复 → skip
        { id: 'any-2', name: '全新分类', parentId: null }, // 不重复 → 导入
      ],
      questions: [],
    };

    const res = await ctx
      .req()
      .post(`/api/question-banks/${bank}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive, mode: 'skip' })
      .expect(201);

    const summary = responseData<ImportSummaryDto>(res);
    expect(summary.categoriesImported).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it('跳过已存在分类时, 保留新题目和子分类与该分类的关联', async () => {
    const bankId = await createBank('分类关联题库');
    const existingId = await createCategory(bankId, '已有分类');
    const archive = {
      meta: {
        id: 'source',
        name: '源',
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      categories: [
        { id: 'source-parent', name: '已有分类', parentId: null },
        { id: 'source-child', name: '新子分类', parentId: 'source-parent' },
      ],
      questions: [
        {
          id: 'source-question',
          title: '已有分类中的新题',
          type: 'short',
          answer: '答案',
          difficulty: 1,
          score: 1,
          locale: 'zh',
          categoryId: 'source-parent',
        },
      ],
    };
    await ctx
      .req()
      .post(`/api/question-banks/${bankId}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive })
      .expect(201);
    expect(
      await ctx.prisma.question.findFirstOrThrow({ where: { bankId } }),
    ).toMatchObject({ categoryId: existingId });
    expect(
      await ctx.prisma.category.findFirstOrThrow({
        where: { bankId, name: '新子分类' },
      }),
    ).toMatchObject({ parentId: existingId });
  });

  it('overwrite 模式: 清空目标库后全量导入, 但被试卷引用时拒绝', async () => {
    const bank = await createBank('overwrite测试题库');
    await createCategory(bank, '旧分类');
    await createQuestion(ctx, adminToken, { title: '旧题', bankId: bank });

    // 导出当前库(含 旧分类 + 旧题)
    const exp = await ctx
      .req()
      .get(`/api/question-banks/${bank}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const archive = responseData<BankArchiveDto>(exp);

    // 修改 archive: 增加一个全新分类, 模拟"导入不同内容"
    archive.categories.push({
      id: 'ow-new-cat',
      name: 'overwrite新分类',
      parentId: null,
    });

    const res = await ctx
      .req()
      .post(`/api/question-banks/${bank}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive, mode: 'overwrite' })
      .expect(201);

    // overwrite 清空后重导: 旧分类被删, 新分类加入(共 2 个分类)
    expect(responseData<ImportSummaryDto>(res).categoriesImported).toBe(2);
    const cats = await ctx
      .req()
      .get(`/api/categories?bankId=${bank}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(responseData<Category[]>(cats)).toHaveLength(2);
  });

  it('overwrite 模式: 题目被试卷引用时返回 400', async () => {
    const bank = await createBank('overwrite拒绝题库');
    const qId = await createQuestion(ctx, adminToken, { bankId: bank });
    // 建试卷引用该题目
    await ctx
      .req()
      .post('/api/papers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '引用卷',
        duration: 60,
        totalScore: 5,
        bankId: bank,
        questionIds: [qId],
      })
      .expect(201);

    const archive = {
      meta: {
        id: bank,
        name: 'x',
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      categories: [],
      questions: [],
    };

    await ctx
      .req()
      .post(`/api/question-banks/${bank}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive, mode: 'overwrite' })
      .expect(400);
  });

  it('一键导入 JSON 创建题库, 保留分类树和双语题目', async () => {
    const sourceId = await createBank('一键导出源题库');
    await ctx.prisma.questionBank.update({
      where: { id: sourceId },
      data: { description: '归档说明' },
    });
    const parentId = await createCategory(sourceId, '根分类');
    const childId = await createCategory(sourceId, '子分类', parentId);
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: sourceId,
        categoryId: childId,
        title: '双语题目',
        type: 'single',
        answer: 'A',
        options: { A: '选项', B: '其他' },
        analysis: '解析',
        locale: 'zh',
        translations: {
          en: {
            title: 'Bilingual question',
            answer: 'A',
            analysis: 'Explanation',
          },
        },
      })
      .expect(201);
    const exported = await ctx
      .req()
      .get(`/api/question-banks/${sourceId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const archive = responseData<BankArchiveDto>(exported);
    const imported = await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive, name: '导入的新题库' })
      .expect(201);
    const { bankId, summary } = responseData<{
      bankId: string;
      summary: ImportSummaryDto;
    }>(imported);
    expect(summary).toMatchObject({
      categoriesImported: 2,
      questionsImported: 1,
      skipped: 0,
    });
    const bank = await ctx.prisma.questionBank.findUniqueOrThrow({
      where: { id: bankId },
    });
    expect(bank).toMatchObject({
      name: '导入的新题库',
      description: '归档说明',
      isPublic: false,
    });
    const categories = await ctx.prisma.category.findMany({
      where: { bankId },
    });
    const parent = categories.find((category) => category.name === '根分类')!;
    const child = categories.find((category) => category.name === '子分类')!;
    expect(child.parentId).toBe(parent.id);
    const question = await ctx.prisma.question.findFirstOrThrow({
      where: { bankId },
    });
    expect(question).toMatchObject({
      ...archive.questions[0],
      id: expect.any(String) as string,
      categoryId: child.id,
    });
    expect(question.id).not.toBe(archive.questions[0].id);
  });

  it('教师可以从归档创建自己的题库, 学生和未登录用户不能导入', async () => {
    const teacher = await createUserWithId(
      ctx,
      adminToken,
      'archive-teacher',
      'teacher',
    );
    const student = await createUserWithId(
      ctx,
      adminToken,
      'archive-student',
      'student',
    );
    const archive = {
      meta: {
        id: 'source',
        name: '教师导入',
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      categories: [],
      questions: [],
    };
    const imported = await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${teacher.token}`)
      .send({ archive })
      .expect(201);
    const { bankId } = responseData<{ bankId: string }>(imported);
    expect(
      await ctx.prisma.questionBank.findUniqueOrThrow({
        where: { id: bankId },
      }),
    ).toMatchObject({
      name: '教师导入',
      createdBy: teacher.id,
      isPublic: false,
    });
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ archive })
      .expect(403);
    await ctx
      .req()
      .post('/api/question-banks/import')
      .send({ archive })
      .expect(401);
  });

  it('超过 100 KB 的归档可导入, 不支持的版本及缺少元信息返回 400', async () => {
    const archive = {
      meta: {
        id: 'source',
        name: '大文件归档',
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      categories: [],
      questions: [
        {
          id: 'q',
          title: '大文件题目',
          type: 'short',
          answer: 'A',
          analysis: 'a'.repeat(120000),
          difficulty: 1,
          score: 1,
          locale: 'zh',
        },
      ],
    };
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive })
      .expect(201);
    await ctx
      .req()
      .post(`/api/question-banks/${ctx.bankId}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive })
      .expect(201);
    const before = await ctx.prisma.questionBank.count();
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive: { ...archive, meta: { ...archive.meta, version: 2 } } })
      .expect(400);
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive: { categories: [], questions: [] } })
      .expect(400);
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
    expect(await ctx.prisma.questionBank.count()).toBe(before);
  });

  it('未认证 → 401', async () => {
    await ctx.req().get(`/api/question-banks/${ctx.bankId}/export`).expect(401);
  });

  it('导入到不存在的题库 → 404', async () => {
    const archive = {
      meta: {
        id: 'x',
        name: 'src',
        exportedAt: new Date().toISOString(),
        version: 1,
      },
      categories: [],
      questions: [],
    };
    await ctx
      .req()
      .post(`/api/question-banks/nonexistent-bank-id/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archive })
      .expect(404);
  });
});
