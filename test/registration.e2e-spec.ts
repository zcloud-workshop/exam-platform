import { Role } from '@prisma/client';
import type { RegistrationInvite, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  TestContext,
  cleanupTestApp,
  createTestApp,
  createUser,
  responseData,
} from './test-utils';

describe('Registration invitations (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
  });

  afterEach(async () => {
    if (ctx) await cleanupTestApp(ctx);
  });

  const createInvite = async (role: Role = Role.student) => {
    const res = await ctx
      .req()
      .post('/api/users/registration-invites')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role })
      .expect(201);
    return responseData<RegistrationInvite>(res);
  };

  const register = (inviteCode: string, username = 'registered_user') =>
    ctx.req().post('/api/auth/register').send({
      username,
      password: '123456',
      inviteCode,
    });

  it.each(Object.values(Role))('邀请码决定注册角色: %s', async (role) => {
    const invite = await createInvite(role);
    expect(invite.code).toMatch(/^[a-f0-9]{32}$/);
    expect(invite.usedAt).toBeNull();

    const res = await register(invite.code).expect(201);
    const user = responseData<User>(res);
    expect(user.role).toBe(role);
    expect(user.password).toBeUndefined();

    const stored = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(await bcrypt.compare('123456', stored.password)).toBe(true);
    const login = await ctx
      .req()
      .post('/api/auth/login')
      .send({ username: user.username, password: '123456' })
      .expect(201);
    expect(responseData<{ user: { role: Role } }>(login).user.role).toBe(role);
  });

  it.each([Role.question_admin, Role.teacher, Role.student])(
    '%s 无权生成, 查看或删除邀请码',
    async (role) => {
      const invite = await createInvite();
      const token = await createUser(ctx, adminToken, `denied_${role}`, role);
      await ctx
        .req()
        .post('/api/users/registration-invites')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: Role.student })
        .expect(403);
      await ctx
        .req()
        .get('/api/users/registration-invites')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await ctx
        .req()
        .delete(`/api/users/registration-invites/${invite.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(
        await ctx.prisma.registrationInvite.findUnique({
          where: { id: invite.id },
        }),
      ).not.toBeNull();
    },
  );

  it('匿名用户不能生成, 查看或删除邀请码', async () => {
    const invite = await createInvite();
    await ctx
      .req()
      .post('/api/users/registration-invites')
      .send({ role: Role.student })
      .expect(401);
    await ctx.req().get('/api/users/registration-invites').expect(401);
    await ctx
      .req()
      .delete(`/api/users/registration-invites/${invite.id}`)
      .expect(401);
    expect(
      await ctx.prisma.registrationInvite.findUnique({
        where: { id: invite.id },
      }),
    ).not.toBeNull();
  });

  it('删除未使用的邀请码后无法注册, 其他邀请码保持可用', async () => {
    const invite = await createInvite();
    const otherInvite = await createInvite();
    const res = await ctx
      .req()
      .delete(`/api/users/registration-invites/${invite.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(responseData<{ success: boolean }>(res)).toEqual({ success: true });
    const list = await ctx
      .req()
      .get('/api/users/registration-invites')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      responseData<RegistrationInvite[]>(list).map((item) => item.id),
    ).toEqual([otherInvite.id]);
    await register(invite.code).expect(400);
    expect(
      await ctx.prisma.user.findUnique({
        where: { username: 'registered_user' },
      }),
    ).toBeNull();
    await register(otherInvite.code).expect(201);
    await ctx
      .req()
      .delete(`/api/users/registration-invites/${invite.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('删除已使用的邀请码不影响已注册账号', async () => {
    const invite = await createInvite();
    const registered = await register(invite.code).expect(201);
    const user = responseData<User>(registered);
    await ctx
      .req()
      .delete(`/api/users/registration-invites/${invite.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      await ctx.prisma.registrationInvite.findUnique({
        where: { id: invite.id },
      }),
    ).toBeNull();
    expect(
      await ctx.prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({ username: user.username, role: Role.student });
    await ctx
      .req()
      .post('/api/auth/login')
      .send({ username: user.username, password: '123456' })
      .expect(201);
    await register(invite.code, 'second_user').expect(400);
  });

  it('删除不存在的邀请码返回 404', async () => {
    const res = await ctx
      .req()
      .delete(
        '/api/users/registration-invites/00000000-0000-0000-0000-000000000000',
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(res.body).toMatchObject({ message: '邀请码不存在' });
  });

  it('并发删除同一邀请码只有一个请求成功', async () => {
    const invite = await createInvite();
    const results = await Promise.all(
      [1, 2].map(() =>
        ctx
          .req()
          .delete(`/api/users/registration-invites/${invite.id}`)
          .set('Authorization', `Bearer ${adminToken}`),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 404]);
    expect(
      await ctx.prisma.registrationInvite.findUnique({
        where: { id: invite.id },
      }),
    ).toBeNull();
  });

  it('拒绝缺失或非法的邀请码角色', async () => {
    for (const body of [{}, { role: 'invalid' }]) {
      await ctx
        .req()
        .post('/api/users/registration-invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(400);
    }
    expect(await ctx.prisma.registrationInvite.count()).toBe(0);
  });

  it('拒绝无效邀请码, 不创建账号', async () => {
    await register('0'.repeat(32)).expect(400);
    expect(
      await ctx.prisma.user.findUnique({
        where: { username: 'registered_user' },
      }),
    ).toBeNull();
  });

  it('拒绝缺少邀请码, 短密码和客户端角色篡改', async () => {
    const invite = await createInvite();
    const body = {
      username: 'registered_user',
      password: '123456',
      inviteCode: invite.code,
    };
    for (const invalid of [
      { username: body.username, password: body.password },
      { ...body, password: '123' },
      { ...body, role: Role.super_admin },
    ]) {
      await ctx.req().post('/api/auth/register').send(invalid).expect(400);
    }
    expect(
      (
        await ctx.prisma.registrationInvite.findUniqueOrThrow({
          where: { id: invite.id },
        })
      ).usedAt,
    ).toBeNull();
    await register(invite.code).expect(201);
  });

  it('邀请码只能使用一次, 列表展示使用时间', async () => {
    const invite = await createInvite();
    await register(invite.code).expect(201);
    await register(invite.code, 'second_user').expect(400);
    const list = await ctx
      .req()
      .get('/api/users/registration-invites')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(responseData<RegistrationInvite[]>(list)[0]).toMatchObject({
      code: invite.code,
      role: Role.student,
    });
    expect(responseData<RegistrationInvite[]>(list)[0].usedAt).toEqual(
      expect.any(String),
    );
    expect(
      await ctx.prisma.user.findUnique({ where: { username: 'second_user' } }),
    ).toBeNull();
  });

  it('用户名冲突回滚邀请码核销, 修改用户名后可重新注册', async () => {
    const invite = await createInvite();
    await register(invite.code, 'admin').expect(409);
    expect(
      (
        await ctx.prisma.registrationInvite.findUniqueOrThrow({
          where: { id: invite.id },
        })
      ).usedAt,
    ).toBeNull();
    await register(` ${invite.code.toUpperCase()} `).expect(201);
  });

  it('同一邀请码并发注册只能成功一次', async () => {
    const invite = await createInvite();
    const results = await Promise.all([
      register(invite.code, 'concurrent_one'),
      register(invite.code, 'concurrent_two'),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 400]);
    expect(
      await ctx.prisma.user.count({
        where: { username: { in: ['concurrent_one', 'concurrent_two'] } },
      }),
    ).toBe(1);
  });
});
