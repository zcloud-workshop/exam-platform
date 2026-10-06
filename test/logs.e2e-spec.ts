import type { OperationLog } from '@prisma/client';
import type { PaginatedResult } from '../src/common/types/pagination';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
} from './test-utils';

type LogResponse = Pick<OperationLog, 'action' | 'username'>;

describe('Logs (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
    teacherToken = await createUser(ctx, adminToken, 'teacher1', 'teacher');

    // 触发一次写操作产生日志
    await ctx
      .req()
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '日志测试分类',
        bankId: ctx.bankId,
      });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 查询 ===

  it('查询日志列表', () => {
    return ctx
      .req()
      .get('/api/logs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<PaginatedResult<LogResponse>>(res);
        expect(data.total).toBeGreaterThanOrEqual(1);
        expect(data.data[0].action).toBeDefined();
      });
  });

  it('按用户名筛选日志', () => {
    return ctx
      .req()
      .get('/api/logs?username=admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<PaginatedResult<LogResponse>>(res);
        expect(data.total).toBeGreaterThanOrEqual(1);
        data.data.forEach((log) => {
          expect(log.username).toContain('admin');
        });
      });
  });

  // === 权限 ===

  it('teacher 无权查看日志', () => {
    return ctx
      .req()
      .get('/api/logs')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });
});
