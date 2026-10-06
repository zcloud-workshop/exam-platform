import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
} from './test-utils';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 登录 ===

  it('登录成功, 返回 JWT token', () => {
    return ctx
      .req()
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' })
      .expect(201)
      .expect((res) => {
        const data = responseData<{ access_token: string }>(res);
        expect(data.access_token).toBeDefined();
      });
  });

  it('密码错误返回 401', () => {
    return ctx
      .req()
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' })
      .expect(401);
  });
});
