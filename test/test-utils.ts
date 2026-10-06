import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import * as dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { json } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

// 应用配置从 .env 加载, 测试连接可以由 shell 中的 TEST_DATABASE_URL 覆盖。
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
dotenv.config({ override: true });
if (testDatabaseUrl) process.env.TEST_DATABASE_URL = testDatabaseUrl;

export interface TestContext {
  app: INestApplication<Server>;
  prisma: PrismaClient;
  req: () => request.Agent;
  login: (username: string, password: string) => Promise<string>;
  /** 测试用默认题库 ID */
  bankId: string;
}

export function responseData<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

export interface ExamSetupResult {
  questionId: string;
  paperId: string;
  examId: string;
}

/**
 * 彻底清空所有业务表 (TRUNCATE CASCADE)。
 * 比 deleteMany 更快更可靠: 单条 DDL, 无视外键顺序, 重置自增序列。
 * 用作每套件 "事前 + 事后" 双保险, 消除套件间数据残留导致的偶发失败。
 */
async function resetDatabase(prisma: PrismaClient) {
  const tables = [
    'registration_invites',
    'operation_logs',
    'files',
    'records',
    'exams',
    'paper_questions',
    'papers',
    'questions',
    'categories',
    'bank_shares',
    'question_banks',
    '"User"',
  ];
  // CASCADE 确保外键依赖不阻塞; RESTART IDENTITY 重置序列
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE;`,
  );
}

export async function createTestApp(): Promise<TestContext> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL 未配置, 请使用独立的 exam_test schema');
  }
  if (new URL(databaseUrl).searchParams.get('schema') !== 'exam_test') {
    throw new Error(
      'TEST_DATABASE_URL 必须使用 exam_test schema, 避免清空业务数据',
    );
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  await prisma.$connect();

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });

  // 事前清空: 确保上一套件 (若 cleanup 失败) 的残留不污染本套件
  await resetDatabase(prisma);

  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      role: 'super_admin',
    },
  });

  const bank = await prisma.questionBank.create({
    data: {
      name: '测试题库',
      description: 'E2E test bank',
      createdBy: admin.id,
    },
  });

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    // 用独立测试 schema 的 prisma 实例替换应用内的 PrismaService,
    // 不再依赖 process.env.DATABASE_URL 的覆盖时机 (Prisma 引擎初始化时机不可靠)
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<Server>>();
  app.use('/api/question-banks', json({ limit: '11mb' }));
  app.use(json());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();

  return {
    app,
    prisma,
    bankId: bank.id,
    req: () => request(app.getHttpServer()),
    login: async (username: string, password: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password });
      return responseData<{ access_token: string }>(res).access_token;
    },
  };
}

export async function cleanupTestApp(ctx: TestContext) {
  // 事后清空: TRUNCATE CASCADE 一次性清掉所有业务表 (含外键依赖)
  // 作为下一套件 "事前清空" 的前置保险, 即使本套件中途崩溃下一套件也能恢复
  await resetDatabase(ctx.prisma);
  await ctx.prisma.$disconnect();
  await ctx.app.close();
}

const DEFAULT_PASSWORD = '123456';

export async function createUser(
  ctx: TestContext,
  adminToken: string,
  username: string,
  role: string,
): Promise<string> {
  const user = await createUserWithId(ctx, adminToken, username, role);
  return user.token;
}

export async function createUserWithId(
  ctx: TestContext,
  adminToken: string,
  username: string,
  role: string,
): Promise<{ id: string; token: string }> {
  await ctx
    .req()
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username, password: DEFAULT_PASSWORD, role });
  const user = await ctx.prisma.user.findUniqueOrThrow({
    where: { username },
    select: { id: true },
  });
  const token = await ctx.login(username, DEFAULT_PASSWORD);
  return { id: user.id, token };
}

export async function createQuestion(
  ctx: TestContext,
  adminToken: string,
  overrides: {
    title?: string;
    type?: string;
    answer?: string;
    score?: number;
    bankId?: string;
  } = {},
): Promise<string> {
  const res = await ctx
    .req()
    .post('/api/questions')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: overrides.title ?? '测试题目',
      type: overrides.type ?? 'single',
      answer: overrides.answer ?? 'A',
      score: overrides.score ?? 5,
      bankId: overrides.bankId ?? ctx.bankId,
    });
  return responseData<{ id: string }>(res).id;
}

export async function setupExam(
  ctx: TestContext,
  adminToken: string,
  options: {
    questionScore?: number;
    answer?: string;
    startTime?: string;
    endTime?: string;
    studentIds?: string[];
  } = {},
): Promise<ExamSetupResult> {
  const questionId = await createQuestion(ctx, adminToken, {
    score: options.questionScore ?? 5,
    answer: options.answer,
  });

  const pRes = await ctx
    .req()
    .post('/api/papers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: '测试试卷',
      duration: 60,
      totalScore: options.questionScore ?? 5,
      bankId: ctx.bankId,
      questionIds: [questionId],
    });

  const paperId = responseData<{ id: string }>(pRes).id;

  const eRes = await ctx
    .req()
    .post('/api/exams')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: '测试考试',
      paperId,
      startTime: options.startTime ?? '2020-01-01T00:00:00Z',
      endTime: options.endTime ?? '2030-12-31T23:59:59Z',
      studentIds: options.studentIds ?? [],
    });

  return {
    questionId,
    paperId,
    examId: responseData<{ id: string }>(eRes).id,
  };
}
