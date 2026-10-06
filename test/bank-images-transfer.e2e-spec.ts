import * as ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { S3Service } from '../src/files/s3.service';
import type { QuestionImage } from '../src/files/question-images.service';
import type {
  BankArchiveDto,
  ImportSummaryDto,
} from '../src/question-banks/dto/bank-archive.dto';
import type { ImportResultDto } from '../src/questions/dto/import-result.dto';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  responseData,
} from './test-utils';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=',
  'base64',
);
const gif = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
const largePng = Buffer.concat([png, Buffer.alloc(30000)]);

describe('Bank image transfer (e2e)', () => {
  let ctx: TestContext;
  let token: string;
  let upload: jest.SpyInstance<Promise<void>, [string, Buffer, string]>;
  const objects = new Map<string, Buffer>();

  const saveObject = (key: string, body: Buffer) => {
    objects.set(key, Buffer.from(body));
    return Promise.resolve();
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await ctx.login('admin', 'admin123');
    const s3 = ctx.app.get(S3Service);
    upload = jest.spyOn(s3, 'upload').mockImplementation(saveObject);
    jest.spyOn(s3, 'download').mockImplementation((key) => {
      const body = objects.get(key);
      return body
        ? Promise.resolve(Readable.from([body]))
        : Promise.reject(new Error('missing image'));
    });
    jest.spyOn(s3, 'delete').mockImplementation((key) => {
      objects.delete(key);
      return Promise.resolve();
    });
    jest.spyOn(s3, 'presignGetObject').mockImplementation((key) =>
      Promise.resolve({
        url: `https://images.example.com/${key}?signature=new`,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      }),
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupTestApp(ctx);
  });

  async function seedBank(name: string) {
    const bank = await ctx
      .req()
      .post('/api/question-banks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    const bankId = responseData<{ id: string }>(bank).id;
    const question = await ctx
      .req()
      .post('/api/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        bankId,
        title: `${name}-题目`,
        type: 'single',
        answer: 'A',
        options: { A: '选项 A', C: '选项 C' },
        translations: { en: { title: 'Question with images', answer: 'A' } },
      })
      .expect(201);
    const questionId = responseData<{ id: string }>(question).id;
    await ctx
      .req()
      .post(`/api/questions/${questionId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', largePng, {
        filename: '题干.png',
        contentType: 'image/png',
      })
      .expect(201);
    await ctx
      .req()
      .post(`/api/questions/${questionId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .field('optionKey', 'C')
      .attach('file', gif, { filename: '选项 C.gif', contentType: 'image/gif' })
      .expect(201);
    return { bankId, questionId };
  }

  async function exportJson(bankId: string) {
    const response = await ctx
      .req()
      .get(`/api/question-banks/${bankId}/export`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return responseData<BankArchiveDto>(response);
  }

  async function exportExcel(bankId: string) {
    const response = await ctx
      .req()
      .get(`/api/questions/export?bankId=${bankId}`)
      .set('Authorization', `Bearer ${token}`)
      .responseType('blob')
      .expect(200);
    return response.body as Buffer;
  }

  async function assertImages(bankId: string) {
    const question = await ctx.prisma.question.findFirstOrThrow({
      where: { bankId },
    });
    const files = await ctx.prisma.file.findMany({
      where: { questionId: question.id },
    });
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file.s3Key).toContain(`question-banks/${bankId}/`);
      expect(file.s3Key).toContain(`/questions/${question.id}/images/`);
      expect(file.url).toBeNull();
      expect(objects.get(file.s3Key)).toEqual(
        file.mimeType === 'image/png' ? largePng : gif,
      );
      expect(file.optionKey).toBe(file.mimeType === 'image/png' ? null : 'C');
    }
    const response = await ctx
      .req()
      .get(`/api/questions/${question.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      responseData<{ images: QuestionImage[] }>(response).images,
    ).toHaveLength(2);
    for (const image of responseData<{ images: QuestionImage[] }>(response)
      .images) {
      expect(image.url).toContain(`/questions/${question.id}/images/`);
    }
    return files;
  }

  it('JSON 携带图片原文件, 源对象删除后仍可恢复题干及选项图片', async () => {
    const source = await seedBank('JSON 图片源');
    const archive = await exportJson(source.bankId);
    expect(archive.meta.version).toBe(2);
    expect(archive.images).toHaveLength(2);
    expect(archive.images!.map((image) => image.data)).toEqual([
      largePng.toString('base64'),
      gif.toString('base64'),
    ]);
    expect(archive.images![0]).not.toHaveProperty('url');
    expect(archive.images![0]).not.toHaveProperty('s3Key');
    const sourceFiles = await ctx.prisma.file.findMany({
      where: { questionId: source.questionId },
    });
    sourceFiles.forEach((file) => objects.delete(file.s3Key));
    const imported = await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ archive, name: 'JSON 图片目标' })
      .expect(201);
    const result = responseData<{ bankId: string; summary: ImportSummaryDto }>(
      imported,
    );
    expect(result.summary.imagesImported).toBe(2);
    await assertImages(result.bankId);
    expect(
      (await exportJson(result.bankId)).images!.map((image) => image.data),
    ).toEqual(archive.images!.map((image) => image.data));
  });

  it('JSON 跳过重复题目时不重复上传图片, 覆盖导入恢复图片并清理旧对象', async () => {
    const source = await seedBank('JSON 覆盖');
    const archive = await exportJson(source.bankId);
    const oldFiles = await ctx.prisma.file.findMany({
      where: { questionId: source.questionId },
    });
    const before = upload.mock.calls.length;
    const skipped = await ctx
      .req()
      .post(`/api/question-banks/${source.bankId}/import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ archive })
      .expect(201);
    expect(responseData<ImportSummaryDto>(skipped)).toMatchObject({
      questionsImported: 0,
      imagesImported: 0,
      skipped: 1,
    });
    expect(upload.mock.calls.length).toBe(before);
    const replaced = await ctx
      .req()
      .post(`/api/question-banks/${source.bankId}/import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ archive, mode: 'overwrite' })
      .expect(201);
    expect(responseData<ImportSummaryDto>(replaced).imagesImported).toBe(2);
    await assertImages(source.bankId);
    oldFiles.forEach((file) => expect(objects.has(file.s3Key)).toBe(false));
  });

  it('图片上传失败时回滚新题库及已经上传的图片', async () => {
    const source = await seedBank('JSON 回滚');
    const archive = await exportJson(source.bankId);
    const before = new Map(objects);
    const bankCount = await ctx.prisma.questionBank.count();
    upload
      .mockImplementationOnce(saveObject)
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ archive, name: '失败题库' })
      .expect(500);
    expect(await ctx.prisma.questionBank.count()).toBe(bankCount);
    expect(objects).toEqual(before);
  });

  it('覆盖导入失败时保留原题目和图片', async () => {
    const source = await seedBank('覆盖回滚');
    const archive = await exportJson(source.bankId);
    const before = new Map(objects);
    upload
      .mockImplementationOnce(saveObject)
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await ctx
      .req()
      .post(`/api/question-banks/${source.bankId}/import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ archive, mode: 'overwrite' })
      .expect(500);
    expect(
      await ctx.prisma.question.findUnique({
        where: { id: source.questionId },
      }),
    ).not.toBeNull();
    expect(objects).toEqual(before);
    await assertImages(source.bankId);
  });

  it('拒绝错误题目关联, 不存在的选项, 伪造 MIME 和不完整图片归档', async () => {
    const source = await seedBank('图片校验');
    const archive = await exportJson(source.bankId);
    const before = upload.mock.calls.length;
    for (const image of [
      { ...archive.images![0], questionId: 'missing' },
      { ...archive.images![0], optionKey: 'D' },
      { ...archive.images![0], mimeType: 'image/jpeg' },
      { ...archive.images![0], data: 'invalid base64' },
      { ...archive.images![0], size: 1 },
    ]) {
      await ctx
        .req()
        .post('/api/question-banks/import')
        .set('Authorization', `Bearer ${token}`)
        .send({ archive: { ...archive, images: [image] } })
        .expect(400);
    }
    await ctx
      .req()
      .post('/api/question-banks/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ archive: { ...archive, images: undefined } })
      .expect(400);
    expect(upload.mock.calls.length).toBe(before);
  });

  it('图片原对象无法读取时拒绝导出, 不生成丢失图片的归档', async () => {
    const source = await seedBank('原图片缺失');
    const files = await ctx.prisma.file.findMany({
      where: { questionId: source.questionId },
    });
    objects.delete(files[0].s3Key);
    await ctx
      .req()
      .get(`/api/question-banks/${source.bankId}/export`)
      .set('Authorization', `Bearer ${token}`)
      .expect(500);
    await ctx
      .req()
      .get(`/api/questions/export?bankId=${source.bankId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(500);
  });

  it('Excel 携带图片预览及完整图片数据, 可恢复至新题库和已有题库', async () => {
    const source = await seedBank('Excel 图片源');
    const body = await exportExcel(source.bankId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(body).buffer);
    expect(workbook.getWorksheet('题目图片')!.getImages()).toHaveLength(2);
    expect(workbook.getWorksheet('_question_images')!.rowCount).toBeGreaterThan(
      3,
    );
    const imported = await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Excel 图片目标')
      .attach('file', body, 'images.xlsx')
      .expect(201);
    const result = responseData<{ bankId: string; summary: ImportResultDto }>(
      imported,
    );
    expect(result.summary).toMatchObject({ success: 1, imagesImported: 2 });
    await assertImages(result.bankId);
    const target = await ctx
      .req()
      .post('/api/question-banks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Excel 已有题库' })
      .expect(201);
    const targetId = responseData<{ id: string }>(target).id;
    const existing = await ctx
      .req()
      .post(`/api/questions/import?bankId=${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', body, 'images.xlsx')
      .expect(201);
    expect(responseData<ImportResultDto>(existing)).toMatchObject({
      success: 1,
      imagesImported: 2,
    });
    await assertImages(targetId);
  });

  it('Excel 支持直接插在题目行内的图片', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('题目');
    sheet.addRow([
      '标题',
      '题型',
      '选项',
      '答案',
      '解析',
      '难度',
      '分值',
      '分类',
      '主语言',
      '翻译',
    ]);
    sheet.addRow(['手工附图题', '简答题', '', '答案', '', 1, 1, '', 'zh', '']);
    const id = workbook.addImage({
      base64: png.toString('base64'),
      extension: 'png',
    });
    sheet.addImage(id, {
      tl: { col: 10, row: 1 },
      ext: { width: 100, height: 100 },
    });
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    const imported = await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${token}`)
      .field('name', '手工 Excel 图片')
      .attach('file', body, 'manual.xlsx')
      .expect(201);
    const result = responseData<{ bankId: string; summary: ImportResultDto }>(
      imported,
    );
    expect(result.summary.imagesImported).toBe(1);
    const files = await ctx.prisma.file.findMany({
      where: { question: { bankId: result.bankId } },
    });
    expect(files).toHaveLength(1);
    expect(objects.get(files[0].s3Key)).toEqual(png);
    expect(files[0].optionKey).toBeNull();
  });

  it('Excel 图片数据被删除时拒绝导入, 上传失败时不留下题库或对象', async () => {
    const source = await seedBank('Excel 回滚');
    const body = await exportExcel(source.bankId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(body).buffer);
    const imageSheet = workbook.getWorksheet('_question_images')!;
    imageSheet.spliceRows(3, 1);
    const truncated = Buffer.from(await workbook.xlsx.writeBuffer());
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${token}`)
      .field('name', '图片被截断题库')
      .attach('file', truncated, 'truncated.xlsx')
      .expect(400);
    workbook.removeWorksheet(workbook.getWorksheet('_question_images')!.id);
    const broken = Buffer.from(await workbook.xlsx.writeBuffer());
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${token}`)
      .field('name', '图片缺失题库')
      .attach('file', broken, 'broken.xlsx')
      .expect(400);
    const before = new Map(objects);
    const bankCount = await ctx.prisma.questionBank.count();
    upload
      .mockImplementationOnce(saveObject)
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await ctx
      .req()
      .post('/api/questions/import/new-bank')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Excel 上传失败题库')
      .attach('file', body, 'images.xlsx')
      .expect(500);
    expect(await ctx.prisma.questionBank.count()).toBe(bankCount);
    expect(objects).toEqual(before);
  });

  it('旧版无图片归档不能覆盖含图片的题库', async () => {
    const source = await seedBank('旧归档保护');
    const archive = await exportJson(source.bankId);
    await ctx
      .req()
      .post(`/api/question-banks/${source.bankId}/import`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        archive: {
          ...archive,
          meta: { ...archive.meta, version: 1 },
          images: undefined,
        },
        mode: 'overwrite',
      })
      .expect(400);
    await assertImages(source.bankId);
  });
});
