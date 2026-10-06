import type { Category } from '@prisma/client';
import {
  TestContext,
  responseData,
  createTestApp,
  cleanupTestApp,
} from './test-utils';

type CategoryResponse = Pick<Category, 'id' | 'name' | 'parentId'>;
type CategoryTreeResponse = CategoryResponse & { children: CategoryResponse[] };

describe('Categories (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let rootId: string;
  let childId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login('admin', 'admin123');
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // === 创建 ===

  it('创建根分类', () => {
    return ctx
      .req()
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '数学', bankId: ctx.bankId })
      .expect(201)
      .expect((res) => {
        const data = responseData<CategoryResponse>(res);
        expect(data.name).toBe('数学');
        expect(data.parentId).toBeNull();
        rootId = data.id;
      });
  });

  it('创建子分类', () => {
    return ctx
      .req()
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '代数', parentId: rootId, bankId: ctx.bankId })
      .expect(201)
      .expect((res) => {
        const data = responseData<CategoryResponse>(res);
        expect(data.parentId).toBe(rootId);
        childId = data.id;
      });
  });

  // === 查询 ===

  it('获取分类列表', () => {
    return ctx
      .req()
      .get('/api/categories')
      .query({ bankId: ctx.bankId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<CategoryResponse[]>(res);
        expect(data.length).toBeGreaterThanOrEqual(1);
      });
  });

  it('获取分类树, 包含父子层级', () => {
    return ctx
      .req()
      .get('/api/categories/tree')
      .query({ bankId: ctx.bankId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        const data = responseData<CategoryTreeResponse[]>(res);
        const target = data.find((r) => r.id === rootId);
        expect(target).toBeDefined();
        expect(target?.children.length).toBeGreaterThanOrEqual(1);
        expect(target?.children[0].parentId).toBe(rootId);
      });
  });

  // === 更新 ===

  it('更新分类名称', () => {
    return ctx
      .req()
      .patch(`/api/categories/${childId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '几何' })
      .expect(200)
      .expect((res) => {
        const data = responseData<CategoryResponse>(res);
        expect(data.name).toBe('几何');
      });
  });

  // === 删除约束 ===

  it('有子分类时拒绝删除', () => {
    return ctx
      .req()
      .delete(`/api/categories/${rootId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
