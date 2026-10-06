import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PracticeController } from './practice.controller';
import { PracticeService } from './practice.service';
import { PersonalPracticeController } from './personal-practice.controller';

describe('PracticeController optional authentication', () => {
  let app: INestApplication;
  const secret = 'practice-auth-test-secret';
  const jwt = new JwtService({ secret });
  const payload = { sub: 'user-id', username: 'student', role: 'student' };
  const token = jwt.sign(payload);
  const expiredToken = jwt.sign({ ...payload, exp: 1 });
  const service = {
    getQuestions: jest.fn(() => Promise.resolve([])),
    getQuestionPage: jest.fn(() => Promise.resolve({})),
    getQuestion: jest.fn(() => Promise.resolve({})),
    checkAnswer: jest.fn(() => Promise.resolve({})),
    setFavorite: jest.fn(() => Promise.resolve({})),
    getSummary: jest.fn(() => Promise.resolve({})),
    getCollection: jest.fn(() => Promise.resolve({})),
    getHistory: jest.fn(() => Promise.resolve({})),
    removeWrongQuestion: jest.fn(() => Promise.resolve({})),
  };

  beforeAll(async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = secret;
    try {
      const module = await Test.createTestingModule({
        controllers: [PracticeController, PersonalPracticeController],
        providers: [
          JwtStrategy,
          { provide: PracticeService, useValue: service },
        ],
      }).compile();
      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ transform: true, whitelist: true }),
      );
      await app.init();
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['anonymous', {}, false],
    ['invalid token', { Authorization: 'Bearer invalid' }, false],
    ['expired token', { Cookie: `exam_token=${expiredToken}` }, false],
    ['bearer session', { Authorization: `Bearer ${token}` }, true],
    ['cookie session', { Cookie: `other=value; exam_token=${token}` }, true],
  ] as const)(
    'passes the verified login status for %s to every practice operation',
    async (_, headers, authenticated) => {
      const server = app.getHttpServer() as Server;
      await request(server)
        .get('/practice/banks/bank-id/questions?mode=random')
        .set(headers)
        .expect(200);
      expect(service.getQuestions).toHaveBeenCalledWith(
        'bank-id',
        'random',
        authenticated ? 'user-id' : undefined,
      );
      await request(server)
        .get('/practice/banks/bank-id/question-pages?page=2')
        .set(headers)
        .expect(200);
      expect(service.getQuestionPage).toHaveBeenCalledWith(
        'bank-id',
        expect.objectContaining({ page: 2 }),
        authenticated ? 'user-id' : undefined,
      );
      await request(server)
        .get('/practice/banks/bank-id/questions/q51')
        .set(headers)
        .expect(200);
      expect(service.getQuestion).toHaveBeenCalledWith(
        'bank-id',
        'q51',
        authenticated ? 'user-id' : undefined,
      );
      await request(server)
        .post('/practice/banks/bank-id/questions/q51/check')
        .set(headers)
        .send({ userAnswer: 'A' })
        .expect(201);
      expect(service.checkAnswer).toHaveBeenCalledWith(
        'bank-id',
        'q51',
        { userAnswer: 'A' },
        authenticated ? 'user-id' : undefined,
      );
    },
  );

  it.each([
    {},
    { Authorization: 'Bearer invalid' },
    { Cookie: `exam_token=${expiredToken}` },
  ])(
    'requires a valid session for personal data and favorite changes (%j)',
    async (headers) => {
      const server = app.getHttpServer() as Server;
      await request(server)
        .get('/practice/mine/summary')
        .set(headers)
        .expect(401);
      await request(server)
        .get('/practice/mine/questions?collection=wrong')
        .set(headers)
        .expect(401);
      await request(server)
        .get('/practice/mine/records')
        .set(headers)
        .expect(401);
      await request(server)
        .delete('/practice/mine/wrong-questions/q1')
        .set(headers)
        .expect(401);
      await request(server)
        .put('/practice/banks/bank-id/questions/q1/favorite')
        .set(headers)
        .expect(401);
      await request(server)
        .delete('/practice/banks/bank-id/questions/q1/favorite')
        .set(headers)
        .expect(401);
      expect(service.setFavorite).not.toHaveBeenCalled();
      expect(service.getSummary).not.toHaveBeenCalled();
    },
  );

  it('uses the verified account for personal operations', async () => {
    const server = app.getHttpServer() as Server;
    const headers = { Cookie: `exam_token=${token}` };
    await request(server)
      .get('/practice/mine/summary')
      .set(headers)
      .expect(200);
    expect(service.getSummary).toHaveBeenCalledWith('user-id');
    await request(server)
      .get('/practice/mine/questions?collection=favorites')
      .set(headers)
      .expect(200);
    expect(service.getCollection).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ collection: 'favorites' }),
    );
    await request(server)
      .get('/practice/mine/records?page=2')
      .set(headers)
      .expect(200);
    expect(service.getHistory).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ page: 2 }),
    );
    await request(server)
      .delete('/practice/mine/wrong-questions/q1')
      .set(headers)
      .expect(200);
    expect(service.removeWrongQuestion).toHaveBeenCalledWith('q1', 'user-id');
    await request(server)
      .put('/practice/banks/bank-id/questions/q1/favorite')
      .set(headers)
      .expect(200);
    expect(service.setFavorite).toHaveBeenCalledWith(
      'bank-id',
      'q1',
      'user-id',
      true,
    );
    await request(server)
      .delete('/practice/banks/bank-id/questions/q1/favorite')
      .set(headers)
      .expect(200);
    expect(service.setFavorite).toHaveBeenCalledWith(
      'bank-id',
      'q1',
      'user-id',
      false,
    );
  });
});
