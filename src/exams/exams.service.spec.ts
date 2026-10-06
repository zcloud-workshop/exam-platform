import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Question, QuestionType, Role } from '@prisma/client';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionImagesService } from '../files/question-images.service';
import { ExamsService } from './exams.service';

describe('ExamsService student question answers', () => {
  const question: Question = {
    id: 'question-1',
    title: 'Which option is correct?',
    type: QuestionType.single,
    options: '{"A":"First","B":"Second"}',
    answer: 'A',
    analysis: 'Choose the first option.',
    difficulty: 1,
    score: 5,
    categoryId: null,
    locale: 'en',
    translations: null,
    bankId: 'bank-1',
  };
  const exam = {
    id: 'exam-1',
    name: 'Exam',
    paperId: 'paper-1',
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: new Date('2026-01-02T00:00:00Z'),
    showScore: false,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    paper: {
      id: 'paper-1',
      name: 'Paper',
      duration: 60,
      totalScore: 5,
      bankId: 'bank-1',
      createdAt: new Date('2025-12-01T00:00:00Z'),
      questions: [
        { paperId: 'paper-1', questionId: question.id, sortOrder: 0, question },
      ],
    },
    participants: [],
    _count: { records: 0, participants: 1 },
  };
  const participant = {
    examId: exam.id,
    userId: 'student-1',
    assignedAt: new Date('2025-12-01T00:00:00Z'),
  };
  const findExam = jest.fn<Promise<typeof exam | null>, []>();
  const findParticipant = jest.fn<Promise<typeof participant | null>, []>();
  const attachToPapers = jest.fn((papers: (typeof exam.paper)[]) =>
    Promise.resolve(papers),
  );
  let service: ExamsService;

  beforeEach(async () => {
    question.translations = null;
    findExam.mockResolvedValue(exam);
    findParticipant.mockResolvedValue(participant);
    attachToPapers.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        ExamsService,
        {
          provide: PrismaService,
          useValue: {
            exam: { findUnique: findExam },
            examParticipant: { findUnique: findParticipant },
          },
        },
        { provide: BankPermissionService, useValue: {} },
        { provide: QuestionImagesService, useValue: { attachToPapers } },
      ],
    }).compile();
    service = module.get(ExamsService);
  });

  it('removes original and translated answers without changing stored data', async () => {
    const translation = {
      title: '哪个选项正确?',
      options: { A: '第一项', B: '第二项' },
      answer: 'A',
      analysis: '选择第一项.',
    };
    question.translations = JSON.stringify({
      zh: translation,
      empty: null,
      invalid: 'translation',
    });

    const result = await service.findOne(
      exam.id,
      participant.userId,
      Role.student,
    );
    const returned = result.paper.questions[0].question;

    expect(returned).not.toHaveProperty('answer');
    expect(returned).not.toHaveProperty('analysis');
    expect(returned.options).toBe(question.options);
    expect(JSON.parse(returned.translations!) as unknown).toEqual({
      zh: { title: translation.title, options: translation.options },
    });
    expect(question.answer).toBe('A');
    expect(JSON.parse(question.translations) as unknown).toHaveProperty(
      'zh.answer',
      'A',
    );
  });

  it.each([
    ['invalid JSON', null],
    ['null', null],
    ['true', '{}'],
    ['1', '{}'],
    ['"translation"', '{}'],
    ['[{"title":"Translated","answer":"A"}]', '{"0":{"title":"Translated"}}'],
    ['{"zh":["First","Second"]}', '{"zh":{"0":"First","1":"Second"}}'],
  ])(
    'preserves compatibility for translations %s',
    async (translations, expected) => {
      question.translations = translations;

      const result = await service.findOne(
        exam.id,
        participant.userId,
        Role.student,
      );

      expect(result.paper.questions[0].question.translations).toBe(expected);
    },
  );

  it('keeps answers for administrators', async () => {
    question.translations = '{"zh":{"answer":"A","analysis":"Explanation"}}';

    const result = await service.findOne(exam.id, 'admin-1', Role.super_admin);

    expect(result).toEqual(exam);
  });

  it('rejects an unassigned student before returning questions', async () => {
    findParticipant.mockResolvedValue(null);

    await expect(
      service.findOne(exam.id, 'unassigned-student', Role.student),
    ).rejects.toThrow(ForbiddenException);
    expect(attachToPapers).not.toHaveBeenCalled();
  });
});
