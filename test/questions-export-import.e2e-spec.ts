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
});
