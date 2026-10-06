import type { BankArchiveDto } from '../src/question-banks/dto/bank-archive.dto';
import type { ImportResultDto } from '../src/questions/dto/import-result.dto';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
} from './test-utils';
import * as ExcelJS from 'exceljs';

function buildImportSheet(...rows: ExcelJS.CellValue[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('题目');
  sheet.columns = [
    { header: '标题', key: 'title' },
    { header: '题型', key: 'type' },
    { header: '选项', key: 'options' },
    { header: '答案', key: 'answer' },
    { header: '解析', key: 'analysis' },
    { header: '难度', key: 'difficulty' },
    { header: '分值', key: 'score' },
    { header: '分类', key: 'category' },
    { header: '主语言', key: 'locale' },
    { header: '翻译', key: 'translations' },
  ];
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
}

describe('Questions Export/Import (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let studentToken: string;
  let categoryId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');

    studentToken = await createUser(ctx, adminToken, 'student1', 'student');

    const catRes = await ctx
      .req()
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '数学',
        bankId: ctx.bankId,
      });
    categoryId = responseData<{ id: string }>(catRes).id;

    await ctx
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
    await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '什么是变量?',
        type: 'short',
        answer: '存储数据的容器',
        difficulty: 2,
        score: 10,
        categoryId,
        bankId: ctx.bankId,
      });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 导出 ===

  it('导出全部题目为 Excel', () => {
    return ctx
      .req()
      .get(`/api/questions/export?bankId=${ctx.bankId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.headers['content-type']).toContain('spreadsheetml');
        expect(res.headers['content-length']).toBeDefined();
        expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
      });
  });

  it('按分类导出题目', () => {
    return ctx
      .req()
      .get(
        `/api/questions/export?bankId=${ctx.bankId}&categoryId=${categoryId}`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.headers['content-type']).toContain('spreadsheetml');
        expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
      });
  });

  it('学生无权导出题目', () => {
    return ctx
      .req()
      .get(`/api/questions/export?bankId=${ctx.bankId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
  });

  // === 导入 ===

  it('成功导入题目', async () => {
    const buffer = await buildImportSheet(
      ['2+2=?', '单选题', '["2","3","4","5"]', '4', '基本加法', 1, 5, ''],
      ['水的化学式?', '填空题', '', 'H2O', '化学基础知识', 2, 10, ''],
    );

    return ctx
      .req()
      .post(`/api/questions/import?bankId=${ctx.bankId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(buffer), {
        filename: 'test.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<ImportResultDto>(res);
        expect(data.total).toBe(2);
        expect(data.success).toBe(2);
        expect(data.failed).toBe(0);
      });
  });

  it('无效题型导入报错', async () => {
    const buffer = await buildImportSheet([
      'test',
      '无效题型',
      '',
      'A',
      '',
      1,
      5,
      '',
    ]);

    return ctx
      .req()
      .post(`/api/questions/import?bankId=${ctx.bankId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(buffer), {
        filename: 'invalid.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<ImportResultDto>(res);
        expect(data.failed).toBe(1);
        expect(data.errors[0].message).toContain('无效题型');
      });
  });
  it('一键 Excel 导入创建题库及分类, 保留选项和双语内容, 可再次导出', async () => {
    const translations = JSON.stringify({
      en: { title: 'Question', answer: 'A', analysis: 'Explanation' },
    });
    const options = JSON.stringify({ A: '正确选项', B: '错误选项' });
    const buffer = await buildImportSheet(
      [
        '双语导入题',
        '单选题',
        options,
        'A',
        '解析',
        2,
        5,
        '新分类',
        'zh',
        translations,
      ],
      ['另一题', '简答题', '', '参考答案', '', 1, 10, '新分类', 'zh', ''],
    );
    const imported = await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Excel 新题库')
      .attach('file', Buffer.from(buffer), 'bank.xlsx')
      .expect(201);
    const { bankId, summary } = responseData<{
      bankId: string;
      summary: ImportResultDto;
    }>(imported);
    expect(summary).toMatchObject({ total: 2, success: 2, failed: 0 });
    const categories = await ctx.prisma.category.findMany({
      where: { bankId },
    });
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ name: '新分类', parentId: null });
    const questions = await ctx.prisma.question.findMany({ where: { bankId } });
    expect(questions).toHaveLength(2);
    expect(
      questions.find((question) => question.title === '双语导入题'),
    ).toMatchObject({
      options,
      answer: 'A',
      analysis: '解析',
      categoryId: categories[0].id,
      locale: 'zh',
      translations,
    });
    const exported = await ctx
      .req()
      .get(`/api/questions/export?bankId=${bankId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .responseType('blob')
      .expect(200);
    const body = exported.body as Buffer;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(body).buffer);
    expect(workbook.worksheets[0].rowCount).toBe(3);
    const row = workbook.worksheets[0]
      .getRows(2, 2)!
      .find((item) => item.getCell(1).text === '双语导入题')!;
    expect(row.getCell(3).text).toBe(options);
    expect(row.getCell(8).text).toBe('新分类');
    expect(row.getCell(10).text).toBe(translations);
    const restored = await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Excel 往返题库')
      .attach('file', body, 'roundtrip.xlsx')
      .expect(201);
    const restoredId = responseData<{ bankId: string }>(restored).bankId;
    expect(
      await ctx.prisma.question.count({ where: { bankId: restoredId } }),
    ).toBe(2);
    const archive = await ctx
      .req()
      .get(`/api/question-banks/${restoredId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      responseData<BankArchiveDto>(archive).questions.find(
        (question) => question.title === '双语导入题',
      ),
    ).toMatchObject({ options, translations });
  });

  it('Excel 新题库导入遇到错误时回滚所有题目和分类', async () => {
    const before = await ctx.prisma.questionBank.count();
    const buffer = await buildImportSheet(
      ['合法题目', '简答题', '', '答案', '', 1, 5, '回滚分类'],
      ['错误题目', '无效题型', '', '答案', '', 1, 5, ''],
    );
    const response = await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', '回滚题库')
      .attach('file', Buffer.from(buffer), 'invalid.xlsx')
      .expect(400);
    expect((response.body as { message: string[] }).message).toContain(
      '第 3 行: 无效题型: 无效题型',
    );
    expect(await ctx.prisma.questionBank.count()).toBe(before);
    expect(
      await ctx.prisma.category.count({ where: { name: '回滚分类' } }),
    ).toBe(0);
    expect(
      await ctx.prisma.question.count({ where: { title: '合法题目' } }),
    ).toBe(0);
  });

  it('Excel 新题库导入拒绝学生, 缺少文件, 无效文件和空名称', async () => {
    const buffer = Buffer.from(
      await buildImportSheet(['题目', '简答题', '', '答案', '', 1, 5, '']),
    );
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${studentToken}`)
      .field('name', '无权题库')
      .attach('file', buffer, 'bank.xlsx')
      .expect(403);
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', '无文件题库')
      .expect(400);
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', '无效文件题库')
      .attach('file', Buffer.from('invalid'), 'invalid.xlsx')
      .expect(400);
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', '   ')
      .attach('file', buffer, 'bank.xlsx')
      .expect(400);
  });
});
