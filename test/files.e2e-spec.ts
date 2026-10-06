import type { File } from '@prisma/client';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
} from './test-utils';

type FileResponse = Pick<File, 'id' | 'originalName' | 'mimeType' | 'size'>;

describe('Files (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let studentToken: string;
  let fileId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
    studentToken = await createUser(ctx, adminToken, 'student1', 'student');
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 上传 ===

  it('上传文件', () => {
    return ctx
      .req()
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('hello world'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      })
      .expect(201)
      .expect((res) => {
        const data = responseData<FileResponse>(res);
        expect(data.originalName).toBe('test.txt');
        expect(data.mimeType).toBe('text/plain');
        expect(data.size).toBeGreaterThan(0);
        fileId = data.id;
      });
  });

  // === 查询 ===

  it('获取文件列表', () => {
    return ctx
      .req()
      .get('/api/files')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<{ total: number }>(res);
        expect(data.total).toBeGreaterThanOrEqual(1);
      });
  });

  it('下载文件', () => {
    return ctx
      .req()
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  // === 删除 ===

  it('admin 删除文件', () => {
    return ctx
      .req()
      .delete(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  // === 权限 ===

  it('student 无权上传文件', () => {
    return ctx
      .req()
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('file', Buffer.from('x'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      })
      .expect(403);
  });

  it('student 无权删除文件', async () => {
    // 先上传一个文件用于删除测试
    const uploadRes = await ctx
      .req()
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('for-delete'), {
        filename: 'del.txt',
        contentType: 'text/plain',
      });

    return ctx
      .req()
      .delete(`/api/files/${responseData<FileResponse>(uploadRes).id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
  });
});
