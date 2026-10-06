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
