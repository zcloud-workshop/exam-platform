import type { Prisma, Question } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuestionImagesService } from '../files/question-images.service';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeService } from './practice.service';
import { QueryPracticeDto } from './dto/query-practice.dto';

type PracticeQuestion = Pick<
  Question,
  | 'id'
  | 'title'
  | 'type'
  | 'options'
  | 'difficulty'
  | 'score'
  | 'locale'
  | 'translations'
>;

function question(id: string, title: string): PracticeQuestion {
  return {
    id,
    title,
    type: 'single',
    options: '{"A":"Option A","B":"Option B"}',
    difficulty: 2,
    score: 1,
    locale: 'en',
    translations: null,
  };
}

describe('PracticeService question ordering', () => {
  const findUnique = jest.fn<
    Promise<{ isPublic: boolean } | null>,
    [Prisma.QuestionBankFindUniqueArgs]
  >();
  const findMany = jest.fn<
    Promise<PracticeQuestion[]>,
    [Prisma.QuestionFindManyArgs]
  >();
  const findFirst = jest.fn<
    Promise<PracticeQuestion | null>,
    [Prisma.QuestionFindFirstArgs]
  >();
  const findQuestion = jest.fn();
  const findStates = jest.fn(() => Promise.resolve([]));
  const createStates = jest.fn(() => Promise.resolve({ count: 1 }));
  const updateState = jest.fn(() => Promise.resolve({}));
  const createAttempt = jest.fn(() => Promise.resolve({}));
  const transaction = jest.fn(
    (callback: (tx: Prisma.TransactionClient) => Promise<void>) =>
      callback({
        userPracticeQuestion: { createMany: createStates, update: updateState },
        practiceAttempt: { create: createAttempt },
      } as unknown as Prisma.TransactionClient),
  );
  const attach = jest.fn<
    Promise<Array<{ id: string; title: string }>>,
    [Array<{ id: string; title: string }>]
  >();
  const service = new PracticeService(
    {
      questionBank: { findUnique },
      question: { findMany, findFirst, findUnique: findQuestion },
      userPracticeQuestion: { findMany: findStates },
      $transaction: transaction,
    } as unknown as PrismaService,
    { attach } as unknown as QuestionImagesService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    findUnique.mockResolvedValue({ isPublic: true });
    attach.mockImplementation((questions) => Promise.resolve(questions));
    findStates.mockResolvedValue([]);
    transaction.mockImplementation((callback) =>
      callback({
        userPracticeQuestion: { createMany: createStates, update: updateState },
        practiceAttempt: { create: createAttempt },
      } as unknown as Prisma.TransactionClient),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sorts sequential practice by numeric source number before attaching images', async () => {
    findMany.mockResolvedValue([
      question('a', 'Question #812 Example'),
      question('b', 'Question #10 Example'),
      question('c', 'Question #2 Example'),
      question('d', 'Question #1 Example'),
      question('e', 'Question #1019 Example'),
    ]);

    const result = await service.getQuestions(
      'bank-id',
      'sequential',
      'user-id',
    );

    expect(result.map((item) => item.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
    expect(attach.mock.calls[0][0].map((item) => item.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
      'e',
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' } }),
    );
  });

  it('puts unnumbered questions last and preserves ID order for ties', async () => {
    findMany.mockResolvedValue([
      question('a', 'Unnumbered question'),
      question('b', '  question # 2 Example'),
      question('c', 'Question #2 Another example'),
      question('d', 'Another unnumbered question'),
      question('e', 'Question #1 Example'),
    ]);

    const result = await service.getQuestions(
      'bank-id',
      'sequential',
      'user-id',
    );

    expect(result.map((item) => item.id)).toEqual(['e', 'b', 'c', 'a', 'd']);
  });

  it('keeps random practice shuffled without sorting by source number', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    findMany.mockResolvedValue([
      question('a', 'Question #812 Example'),
      question('b', 'Question #10 Example'),
      question('c', 'Question #2 Example'),
      question('d', 'Question #1 Example'),
      question('e', 'Question #1019 Example'),
    ]);

    const result = await service.getQuestions('bank-id', 'random', 'user-id');

    expect(result.map((item) => item.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: undefined }),
    );
  });

  it('loads and signs at most 50 question details per page, including the final partial page', async () => {
    const items = Array.from({ length: 123 }, (_, index) =>
      question(`q${index}`, `Question #${index + 1} Example`),
    );
    findMany.mockImplementation(() => Promise.resolve([...items]));

    const first = await service.getQuestionPage('bank-id', {}, 'user-id');
    expect(first.data).toHaveLength(50);
    expect(first).toMatchObject({
      total: 123,
      questionTotal: 123,
      page: 1,
      pageSize: 50,
    });
    expect(first.data.map((item) => item.index)).toEqual(
      Array.from({ length: 50 }, (_, index) => index),
    );
    expect(findMany.mock.calls[0][0].select).toEqual({ id: true, title: true });
    expect(findMany.mock.calls[1][0].where).toEqual({
      bankId: 'bank-id',
      id: { in: items.slice(0, 50).map((item) => item.id) },
    });
    expect(attach.mock.calls[0][0]).toHaveLength(50);

    const last = await service.getQuestionPage(
      'bank-id',
      {
        page: 3,
        seed: first.seed,
      },
      'user-id',
    );
    expect(last.data).toHaveLength(23);
    expect(last.data[0].index).toBe(100);
    expect(last.data[22].index).toBe(122);
    expect(attach.mock.calls[1][0]).toHaveLength(23);
  });

  it('keeps seeded random pages stable without duplicates or omissions', async () => {
    const items = Array.from({ length: 123 }, (_, index) =>
      question(`q${index}`, `Question #${index + 1} Example`),
    );
    findMany.mockImplementation(() => Promise.resolve([...items]));
    const first = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: 'session-one',
      },
      'user-id',
    );
    const second = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: first.seed,
        page: 2,
      },
      'user-id',
    );
    const third = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: first.seed,
        page: 3,
      },
      'user-id',
    );
    const repeated = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: first.seed,
      },
      'user-id',
    );
    const anotherSession = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: 'session-two',
      },
      'user-id',
    );

    expect(
      new Set(
        [...first.data, ...second.data, ...third.data].map((item) => item.id),
      ).size,
    ).toBe(123);
    expect(repeated.data).toEqual(first.data);
    expect(anotherSession.data.map((item) => item.id)).not.toEqual(
      first.data.map((item) => item.id),
    );
  });

  it.each([
    ['  SEARCHTITLE  ', 110],
    ['optionneedle', 111],
    ['翻译题干', 112],
    ['translatedoption', 112],
    ['serializedoption', 113],
  ])(
    'searches all questions for %s and preserves the original position',
    async (keyword, index) => {
      const items = Array.from({ length: 120 }, (_, offset) =>
        question(`q${offset}`, `Question #${offset + 1} Example`),
      );
      items[110].title += ' SearchTitle';
      items[111].options = JSON.stringify({ A: 'OptionNeedle' });
      items[112].translations = JSON.stringify({
        zh: {
          title: '翻译题干',
          options: { A: 'TranslatedOption' },
          answer: 'SecretNeedle',
          analysis: 'SecretNeedle',
        },
      });
      items[113].translations = JSON.stringify({
        zh: { options: JSON.stringify({ A: 'SerializedOption' }) },
      });
      findMany.mockImplementation(() => Promise.resolve([...items]));

      const result = await service.getQuestionPage(
        'bank-id',
        { keyword },
        'user-id',
      );
      expect(result).toMatchObject({ total: 1, questionTotal: 120 });
      expect(result.data[0]).toMatchObject({ id: `q${index}`, index });
      expect(result.data[0]).not.toHaveProperty('answer');
      expect(result.data[0]).not.toHaveProperty('analysis');
      expect(result.data[0].translations ?? {}).not.toHaveProperty('zh.answer');
      expect(result.data[0].translations ?? {}).not.toHaveProperty(
        'zh.analysis',
      );

      const secrets = await service.getQuestionPage(
        'bank-id',
        {
          keyword: 'SecretNeedle',
        },
        'user-id',
      );
      expect(secrets.total).toBe(0);
      expect(secrets.data).toEqual([]);
    },
  );

  it('paginates search matches and keeps random search positions consistent with practice', async () => {
    const items = Array.from({ length: 123 }, (_, index) =>
      question(`q${index}`, `Question #${index + 1} Example`),
    );
    findMany.mockImplementation(() => Promise.resolve([...items]));
    const page = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: 'session',
        page: 2,
      },
      'user-id',
    );
    const search = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: 'session',
        page: 2,
        keyword: 'example',
      },
      'user-id',
    );
    expect(search.data).toEqual(page.data);
    expect(search.total).toBe(123);

    const found = await service.getQuestionPage(
      'bank-id',
      {
        mode: 'random',
        seed: 'session',
        keyword: page.data[0].title,
      },
      'user-id',
    );
    expect(found.data[0].index).toBe(50);
  });

  it('returns an empty page without fetching full question details', async () => {
    findMany.mockResolvedValue([question('q1', 'Question #1 Example')]);
    const result = await service.getQuestionPage(
      'bank-id',
      { page: 2 },
      'user-id',
    );
    expect(result).toMatchObject({ data: [], total: 1 });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('refreshes one public question without returning answer translations', async () => {
    findFirst.mockResolvedValue({
      ...question('q1', 'Question #1 Example'),
      translations: JSON.stringify({
        zh: { title: '题干', answer: 'A', analysis: 'Secret' },
      }),
    });
    const result = await service.getQuestion('bank-id', 'q1', 'user-id');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'q1', bankId: 'bank-id' } }),
    );
    expect(result.translations).toEqual({ zh: { title: '题干' } });
    expect(findMany).not.toHaveBeenCalled();
    expect(attach.mock.calls[0][0]).toHaveLength(1);
  });

  it('rejects missing or cross-bank questions and closed banks', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      service.getQuestion('bank-id', 'other-bank-question', 'user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    findUnique.mockResolvedValue({ isPublic: false });
    await expect(
      service.getQuestionPage('bank-id', {}, 'user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getQuestion('bank-id', 'q1', 'user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('limits guests to the first 50 sequential questions across list and page endpoints', async () => {
    const items = Array.from({ length: 123 }, (_, index) =>
      question(`q${index}`, `Question #${123 - index} Example`),
    );
    findMany.mockImplementation(() => Promise.resolve([...items]));

    const list = await service.getQuestions('bank-id', 'sequential');
    expect(list).toHaveLength(50);
    expect(list[0].title).toContain('Question #1 ');
    expect(list[49].title).toContain('Question #50 ');
    await expect(
      service.getQuestions('bank-id', 'sequential', 'user-id'),
    ).resolves.toHaveLength(123);

    const page = await service.getQuestionPage('bank-id', { pageSize: 100 });
    expect(page).toMatchObject({
      total: 50,
      questionTotal: 123,
      practiceTotal: 50,
    });
    expect(page.data.map((item) => item.id)).toEqual(
      list.map((item) => item.id),
    );
    expect(page.data[49].index).toBe(49);

    const nextPage = await service.getQuestionPage('bank-id', {
      page: 2,
      pageSize: 25,
    });
    expect(nextPage.data).toHaveLength(25);
    expect(nextPage.data[0].index).toBe(25);
    const beyondLimit = await service.getQuestionPage('bank-id', {
      page: 3,
      pageSize: 25,
    });
    expect(beyondLimit.data).toEqual([]);
    expect(beyondLimit.total).toBe(50);
  });

  it('rejects anonymous random practice in both list endpoints before signing images', async () => {
    findMany.mockResolvedValue([question('q1', 'Question #1 Example')]);
    await expect(
      service.getQuestions('bank-id', 'random'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getQuestionPage('bank-id', { mode: 'random', seed: 'session' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attach).not.toHaveBeenCalled();
  });

  it('searches only the first 50 questions even when a later question matches', async () => {
    const items = Array.from({ length: 60 }, (_, index) =>
      question(`q${index}`, `Question #${index + 1} Example`),
    );
    items[49].options = JSON.stringify({ A: 'GuestNeedle' });
    items[50].translations = JSON.stringify({ zh: { title: 'GuestNeedle' } });
    findMany.mockImplementation(() => Promise.resolve([...items]));
    const result = await service.getQuestionPage('bank-id', {
      keyword: 'guestneedle',
    });
    expect(result).toMatchObject({
      total: 1,
      questionTotal: 60,
      practiceTotal: 50,
      matchingIndexes: [49],
    });
    expect(result.data.map((item) => item.id)).toEqual(['q49']);
    expect(findMany.mock.calls[1][0].where).toEqual({
      bankId: 'bank-id',
      id: { in: items.slice(0, 50).map((item) => item.id) },
    });
    const hidden = await service.getQuestionPage('bank-id', {
      keyword: 'Question #51 ',
    });
    expect(hidden.data).toEqual([]);
    expect(hidden.matchingIndexes).toEqual([]);
  });

  it.each([0, 49, 50])(
    'allows guest question and answer access only inside the first 50, at index %i',
    async (index) => {
      const items = Array.from({ length: 60 }, (_, offset) =>
        question(`q${offset}`, `Question #${offset + 1} Example`),
      );
      findMany.mockImplementation(() => Promise.resolve([...items]));
      findFirst.mockResolvedValue(items[index]);
      findQuestion.mockResolvedValue({
        ...items[index],
        bankId: 'bank-id',
        answer: 'A',
        analysis: 'Explanation',
      });
      if (index < 50) {
        await expect(
          service.getQuestion('bank-id', `q${index}`),
        ).resolves.toMatchObject({ id: `q${index}` });
        await expect(
          service.checkAnswer('bank-id', `q${index}`, { userAnswer: 'A' }),
        ).resolves.toEqual({
          correct: true,
          graded: true,
          answer: 'A',
          analysis: 'Explanation',
        });
      } else {
        await expect(
          service.getQuestion('bank-id', `q${index}`),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          service.checkAnswer('bank-id', `q${index}`, { userAnswer: 'A' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(attach).not.toHaveBeenCalled();
        await expect(
          service.getQuestion('bank-id', `q${index}`, 'user-id'),
        ).resolves.toMatchObject({ id: `q${index}` });
        await expect(
          service.checkAnswer(
            'bank-id',
            `q${index}`,
            { userAnswer: 'A' },
            'user-id',
          ),
        ).resolves.toMatchObject({ correct: true });
      }
    },
  );

  it.each([0, 10, 50])(
    'keeps a guest bank with %i questions fully accessible',
    async (count) => {
      const items = Array.from({ length: count }, (_, index) =>
        question(`q${index}`, `Question #${index + 1} Example`),
      );
      findMany.mockImplementation(() => Promise.resolve([...items]));
      const result = await service.getQuestionPage('bank-id', {});
      expect(result).toMatchObject({
        total: count,
        questionTotal: count,
        practiceTotal: count,
      });
      expect(result.data).toHaveLength(count);
    },
  );
});

describe('Practice pagination query validation', () => {
  it('defaults to 50 and converts numeric query parameters', async () => {
    expect(new QueryPracticeDto().pageSize).toBe(50);
    const query = plainToInstance(QueryPracticeDto, {
      page: '2',
      pageSize: '50',
      mode: 'random',
    });
    expect(query).toMatchObject({ page: 2, pageSize: 50 });
    expect(await validate(query)).toEqual([]);
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { pageSize: 101 },
    { pageSize: 0 },
    { mode: 'unknown' },
  ])('rejects invalid parameters %j', async (params) => {
    expect(
      await validate(plainToInstance(QueryPracticeDto, params)),
    ).not.toHaveLength(0);
  });
});
