import type { Role, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
  createUser,
  createUserWithId,
  createQuestion,
  setupExam,
} from './test-utils';

type UserResponse = Pick<User, 'id' | 'username'> & { password?: unknown };

describe('Users (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let teacherToken: string;
  let createdUserId: string;
  let bankRecipient: { id: string; token: string };

  async function createManagedUser(username: string, role: Role) {
    const res = await ctx
      .req()
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username, password: '123456', role })
      .expect(201);
    return responseData<UserResponse>(res);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    const res = await ctx
      .req()
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' })
      .expect(201);
    adminToken = responseData<{ access_token: string }>(res).access_token;
    teacherToken = await createUser(ctx, adminToken, 'teacher1', 'teacher');
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 创建 ===

  it('创建用户', () => {
    return ctx
      .req()
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newuser', password: '123456', role: 'student' })
      .expect(201)
      .expect((res) => {
        const data = responseData<UserResponse>(res);
        expect(data.username).toBe('newuser');
        expect(data.password).toBeUndefined();
        createdUserId = data.id;
      });
  });

  // === 查询 ===

  it('获取用户列表', () => {
    return ctx
      .req()
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<UserResponse[]>(res);
        expect(data.length).toBeGreaterThanOrEqual(2);
      });
  });

  // === 更新 ===

  it('更新用户', () => {
    return ctx
      .req()
      .patch(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'updated_user' })
      .expect(200)
      .expect((res) => {
        const data = responseData<UserResponse>(res);
        expect(data.username).toBe('updated_user');
      });
  });

  // === 权限 ===

  it('teacher 无权限创建用户', () => {
    return ctx
      .req()
      .post('/api/users')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ username: 'hack', password: '123456' })
      .expect(403);
  });

  // === 删除 ===

  it('拒绝删除最后一个超级管理员, 题库管理员不能替代', async () => {
    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const questionAdmin = await createManagedUser(
      'question_admin',
      'question_admin',
    );

    await ctx
      .req()
      .delete(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect(res.body as unknown).toHaveProperty(
          'message',
          '不能删除最后一个超级管理员, 请先将其他用户设为超级管理员',
        );
      });
    expect(await ctx.prisma.user.count({ where: { id: admin.id } })).toBe(1);

    await ctx
      .req()
      .delete(`/api/users/${questionAdmin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('必须转移全部题库后才能删除用户, 转移保留题目并变更权限', async () => {
    const owner = await createUserWithId(
      ctx,
      adminToken,
      'bank_owner',
      'teacher',
    );
    const recipient = await createUserWithId(
      ctx,
      adminToken,
      'bank_recipient',
      'teacher',
    );
    bankRecipient = recipient;
    const bankIds: string[] = [];
    for (const name of ['待转移题库一', '待转移题库二']) {
      const res = await ctx
        .req()
        .post('/api/question-banks')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name })
        .expect(201);
      bankIds.push(responseData<{ id: string }>(res).id);
    }
    const questionId = await createQuestion(ctx, owner.token, {
      bankId: bankIds[0],
    });

    for (const bankId of bankIds) {
      await ctx
        .req()
        .delete(`/api/users/${owner.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400)
        .expect((res) => {
          expect(res.body as unknown).toHaveProperty(
            'message',
            expect.stringContaining('请先将全部题库转移'),
          );
        });
      await ctx
        .req()
        .patch(`/api/question-banks/${bankId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createdBy: recipient.id })
        .expect(200)
        .expect((res) => {
          expect(responseData<{ createdBy: string }>(res).createdBy).toBe(
            recipient.id,
          );
        });
    }

    await ctx
      .req()
      .patch(`/api/question-banks/${bankIds[0]}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '无权修改' })
      .expect(403);
    await ctx
      .req()
      .patch(`/api/question-banks/${bankIds[0]}`)
      .set('Authorization', `Bearer ${recipient.token}`)
      .send({ name: '接收后的题库' })
      .expect(200);
    await ctx
      .req()
      .delete(`/api/users/${owner.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(await ctx.prisma.question.count({ where: { id: questionId } })).toBe(
      1,
    );
    expect(
      await ctx.prisma.questionBank.count({
        where: { id: { in: bankIds }, createdBy: recipient.id },
      }),
    ).toBe(2);
  });

  it('拒绝无权转移和无效的题库接收人, 所有者可转移给管理员', async () => {
    const recipient = await createManagedUser(
      'transfer_admin',
      'question_admin',
    );
    const teacher = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'teacher1' },
    });
    const bank = await ctx.prisma.questionBank.create({
      data: { name: '权限转移测试', createdBy: bankRecipient.id },
    });
    await ctx.prisma.bankShare.create({
      data: { bankId: bank.id, userId: teacher.id, role: 'editor' },
    });
    await ctx
      .req()
      .patch(`/api/question-banks/${bank.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ createdBy: recipient.id })
      .expect(403);

    for (const createdBy of [null, '', 'not-a-uuid']) {
      await ctx
        .req()
        .patch(`/api/question-banks/${bank.id}`)
        .set('Authorization', `Bearer ${bankRecipient.token}`)
        .send({ createdBy })
        .expect(400);
    }
    await ctx
      .req()
      .patch(`/api/question-banks/${bank.id}`)
      .set('Authorization', `Bearer ${bankRecipient.token}`)
      .send({ createdBy: randomUUID() })
      .expect(404);
    await ctx
      .req()
      .patch(`/api/question-banks/${bank.id}`)
      .set('Authorization', `Bearer ${bankRecipient.token}`)
      .send({ createdBy: createdUserId })
      .expect(400);
    expect(
      await ctx.prisma.questionBank.findUniqueOrThrow({
        where: { id: bank.id },
      }),
    ).toHaveProperty('createdBy', bankRecipient.id);

    await ctx
      .req()
      .patch(`/api/question-banks/${bank.id}`)
      .set('Authorization', `Bearer ${bankRecipient.token}`)
      .send({ createdBy: recipient.id })
      .expect(200);
  });

  it('仍有题库分享时返回明确的删除错误并保留用户', async () => {
    const teacher = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'teacher1' },
    });
    await ctx
      .req()
      .delete(`/api/users/${teacher.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect(res.body as unknown).toHaveProperty(
          'message',
          '该用户仍有题库分享, 请先移除分享关系后再删除',
        );
      });
    expect(await ctx.prisma.user.count({ where: { id: teacher.id } })).toBe(1);
  });

  it('仍拒绝删除有考试分配或答题记录的用户', async () => {
    const student = await createManagedUser('assigned_student', 'student');
    const { examId } = await setupExam(ctx, adminToken, {
      studentIds: [student.id],
    });
    await ctx
      .req()
      .delete(`/api/users/${student.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect(res.body as unknown).toHaveProperty(
          'message',
          '该用户已被分配到 1 场考试, 无法删除',
        );
      });
    await ctx.prisma.record.create({ data: { examId, userId: student.id } });
    await ctx
      .req()
      .delete(`/api/users/${student.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400)
      .expect((res) => {
        expect(res.body as unknown).toHaveProperty(
          'message',
          '该用户有 1 条答题记录, 无法删除',
        );
      });
  });

  it('删除不存在的用户返回 404', () => {
    return ctx
      .req()
      .delete(`/api/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('删除用户', () => {
    return ctx
      .req()
      .delete(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('设置另一人为超级管理员后可删除, 并发删除仍保留一名超级管理员', async () => {
    const replacement = await createManagedUser('replacement_admin', 'teacher');
    await ctx
      .req()
      .patch(`/api/users/${replacement.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'super_admin' })
      .expect(200);
    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const teacher = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'teacher1' },
    });
    await ctx
      .req()
      .patch(`/api/question-banks/${ctx.bankId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ createdBy: teacher.id })
      .expect(200);

    const responses = await Promise.all(
      [admin.id, replacement.id].map((id) =>
        ctx
          .req()
          .delete(`/api/users/${id}`)
          .set('Authorization', `Bearer ${adminToken}`),
      ),
    );
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(
      responses.filter((res) => res.status === 400 || res.status === 409),
    ).toHaveLength(1);
    expect(
      await ctx.prisma.user.count({ where: { role: 'super_admin' } }),
    ).toBe(1);
    const remainingAdmin = await ctx.prisma.user.findFirstOrThrow({
      where: { role: 'super_admin' },
    });
    await ctx
      .req()
      .delete(`/api/users/${remainingAdmin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
