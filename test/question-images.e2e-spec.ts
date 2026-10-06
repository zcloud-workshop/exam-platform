import { Readable } from 'node:stream';
import type { BankArchiveDto } from '../src/question-banks/dto/bank-archive.dto';
import {
  QuestionImagesService,
  QuestionImage,
} from '../src/files/question-images.service';
import { S3Service } from '../src/files/s3.service';
import {
  TestContext,
  cleanupTestApp,
  createQuestion,
  createTestApp,
  createUserWithId,
  responseData,
} from './test-utils';

type QuestionResponse = {
  id: string;
  images: QuestionImage[];
  translations: unknown;
};
type PaperResponse = { questions: { question: QuestionResponse }[] };

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=',
  'base64',
);

describe('Question images (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;
  let studentToken: string;
  let studentId: string;
  let questionId: string;
  let imageId: string;
  const optionImageIds: string[] = [];
  let privateQuestionId: string;
  let paperId: string;
  let examId: string;
  let signedSequence = 0;
  const upload = jest.fn<Promise<void>, [string, Buffer, string]>();
  const deleteObject = jest.fn<Promise<void>, [string]>();
  const sign = jest.fn((key: string) =>
    Promise.resolve({
      url: `https://storage.example.com/${key}?signature=${++signedSequence}`,
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    }),
  );

  beforeAll(async () => {
    ctx = await createTestApp();
    const s3 = ctx.app.get(S3Service);
    jest.spyOn(s3, 'upload').mockImplementation(upload);
    jest.spyOn(s3, 'delete').mockImplementation(deleteObject);
    jest.spyOn(s3, 'presignGetObject').mockImplementation(sign);
    upload.mockResolvedValue(undefined);
    deleteObject.mockResolvedValue(undefined);
    adminToken = await ctx.login('admin', 'admin123');
    const editor = await createUserWithId(
      ctx,
      adminToken,
      'image-editor',
      'teacher',
    );
    const viewer = await createUserWithId(
      ctx,
      adminToken,
      'image-viewer',
      'teacher',
    );
    const student = await createUserWithId(
      ctx,
      adminToken,
      'image-student',
      'student',
    );
    editorToken = editor.token;
    viewerToken = viewer.token;
    studentToken = student.token;
    studentId = student.id;
    await ctx.prisma.bankShare.createMany({
      data: [
        { bankId: ctx.bankId, userId: editor.id, role: 'editor' },
        { bankId: ctx.bankId, userId: viewer.id, role: 'viewer' },
      ],
    });
    questionId = await createQuestion(ctx, adminToken);
    await ctx.prisma.question.update({
      where: { id: questionId },
      data: {
        options: JSON.stringify({
          A: 'First',
          B: 'Second',
          C: 'Third',
          D: 'Fourth',
        }),
        analysis: 'Secret analysis',
        translations: JSON.stringify({
          en: {
            title: 'Translated',
            answer: 'A',
            analysis: 'Secret translation',
          },
        }),
      },
    });
    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const privateBank = await ctx.prisma.questionBank.create({
      data: { name: 'Private', createdBy: admin.id },
    });
    privateQuestionId = await createQuestion(ctx, adminToken, {
      bankId: privateBank.id,
    });
    const paper = await ctx
      .req()
      .post('/api/papers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Image paper',
        duration: 60,
        totalScore: 5,
        bankId: ctx.bankId,
        questionIds: [questionId],
      })
      .expect(201);
    paperId = responseData<{ id: string }>(paper).id;
    const exam = await ctx
      .req()
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Image exam',
        paperId,
        startTime: '2020-01-01T00:00:00Z',
        endTime: '2030-12-31T23:59:59Z',
      })
      .expect(201);
    examId = responseData<{ id: string }>(exam).id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupTestApp(ctx);
  });

  function imageRequest(
    id: string,
    token: string,
    buffer = png,
    contentType = 'image/png',
  ) {
    return ctx
      .req()
      .post(`/api/questions/${id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, { filename: '../policy.svg', contentType });
  }

  it('uploads an image as a bank editor with an isolated, canonical object key', async () => {
    const response = await imageRequest(questionId, editorToken).expect(201);
    const image = responseData<QuestionImage>(response);
    imageId = image.id;
    expect(image.mimeType).toBe('image/png');
    expect(image.optionKey).toBeNull();
    expect(image.url).toContain('?signature=');
    expect(image).not.toHaveProperty('s3Key');
    const stored = await ctx.prisma.file.findUniqueOrThrow({
      where: { id: imageId },
    });
    expect(stored.questionId).toBe(questionId);
    expect(stored.url).toBeNull();
    expect(stored.s3Key).toMatch(
      new RegExp(
        `^question-banks/${ctx.bankId}/questions/${questionId}/images/[^/]+\\.png$`,
      ),
    );
    expect(upload).toHaveBeenCalledWith(stored.s3Key, png, 'image/png');
  });

  it('binds C and D images to their option keys rather than the question stem', async () => {
    for (const optionKey of ['C', 'D']) {
      const response = await imageRequest(questionId, editorToken)
        .field('optionKey', optionKey)
        .expect(201);
      const image = responseData<QuestionImage>(response);
      optionImageIds.push(image.id);
      expect(image.optionKey).toBe(optionKey);
      const stored = await ctx.prisma.file.findUniqueOrThrow({
        where: { id: image.id },
      });
      expect(stored.optionKey).toBe(optionKey);
      expect(stored.questionId).toBe(questionId);
    }
  });

  it('rejects missing option keys without uploading objects', async () => {
    const before = upload.mock.calls.length;
    await imageRequest(questionId, editorToken)
      .field('optionKey', 'E')
      .expect(400);
    await imageRequest(questionId, editorToken)
      .field('optionKey', '')
      .expect(400);
    await imageRequest(privateQuestionId, adminToken)
      .field('optionKey', 'C')
      .expect(400);
    expect(upload.mock.calls.length).toBe(before);
  });

  it('supports label keys in the option arrays used by AI-generated questions', async () => {
    const id = await createQuestion(ctx, adminToken);
    await ctx.prisma.question.update({
      where: { id },
      data: { options: JSON.stringify([{ label: 'A', text: 'First' }]) },
    });
    const response = await imageRequest(id, adminToken)
      .field('optionKey', 'A')
      .expect(201);
    const image = responseData<QuestionImage>(response);
    expect(image.optionKey).toBe('A');
    await ctx
      .req()
      .delete(`/api/questions/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      await ctx.prisma.file.findUnique({ where: { id: image.id } }),
    ).toBeNull();
  });

  it('rejects viewer uploads, cross-bank access, student uploads and anonymous uploads', async () => {
    const before = upload.mock.calls.length;
    await imageRequest(questionId, viewerToken).expect(403);
    await imageRequest(privateQuestionId, editorToken).expect(403);
    await imageRequest(questionId, studentToken).expect(403);
    await ctx
      .req()
      .post(`/api/questions/${questionId}/images`)
      .attach('file', png, 'a.png')
      .expect(401);
    expect(upload.mock.calls.length).toBe(before);
  });

  it('rejects missing, forged, unsupported and oversized images before storing them', async () => {
    const before = upload.mock.calls.length;
    await ctx
      .req()
      .post(`/api/questions/${questionId}/images`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(400);
    await imageRequest(questionId, editorToken, Buffer.from('fake png')).expect(
      400,
    );
    await imageRequest(
      questionId,
      editorToken,
      Buffer.from('<svg/>'),
      'image/svg+xml',
    ).expect(400);
    await imageRequest(
      questionId,
      editorToken,
      Buffer.alloc(10 * 1024 * 1024 + 1),
    ).expect(413);
    expect(upload.mock.calls.length).toBe(before);
  });

  it('returns signed images in authorized question and paper reads and refreshes URLs', async () => {
    const read = () =>
      ctx
        .req()
        .get(`/api/questions/${questionId}?locale=en`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    const first = responseData<QuestionResponse>(await read());
    const second = responseData<QuestionResponse>(await read());
    expect(first.images[0].id).toBe(imageId);
    expect(first.images.map((image) => image.optionKey)).toEqual([
      null,
      'C',
      'D',
    ]);
    expect(first.images[0].url).not.toBe(second.images[0].url);
    const list = await ctx
      .req()
      .get(`/api/questions?bankId=${ctx.bankId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(
      responseData<{ data: QuestionResponse[] }>(list).data[0].images[0].id,
    ).toBe(imageId);
    const paper = await ctx
      .req()
      .get(`/api/papers/${paperId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(
      responseData<PaperResponse>(paper).questions[0].question.images[0].id,
    ).toBe(imageId);
    expect(
      responseData<PaperResponse>(paper).questions[0].question.images.map(
        (image) => image.optionKey,
      ),
    ).toEqual([null, 'C', 'D']);
    const papers = await ctx
      .req()
      .get(`/api/papers?bankId=${ctx.bankId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(
      responseData<{ data: PaperResponse[] }>(papers).data[0].questions[0]
        .question.images[0].id,
    ).toBe(imageId);
    const before = sign.mock.calls.length;
    await ctx
      .req()
      .get(`/api/questions/${privateQuestionId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
    expect(sign.mock.calls.length).toBe(before);
  });

  it('signs exam images only after assignment and keeps answers hidden', async () => {
    const before = sign.mock.calls.length;
    await ctx
      .req()
      .get(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
    expect(sign.mock.calls.length).toBe(before);
    await ctx.prisma.examParticipant.create({
      data: { examId, userId: studentId },
    });
    const response = await ctx
      .req()
      .get(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    const question = responseData<{ paper: PaperResponse }>(response).paper
      .questions[0].question;
    expect(question.images[0].id).toBe(imageId);
    expect(question.images.map((image) => image.optionKey)).toEqual([
      null,
      'C',
      'D',
    ]);
    expect(question).not.toHaveProperty('answer');
    expect(question).not.toHaveProperty('analysis');
    expect(
      JSON.parse(question.translations as string) as unknown,
    ).not.toHaveProperty('en.answer');
    expect(
      JSON.parse(question.translations as string) as unknown,
    ).not.toHaveProperty('en.analysis');
  });

  it('returns images in public practice without exposing answer translations', async () => {
    await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/questions`)
      .expect(404);
    await ctx.prisma.questionBank.update({
      where: { id: ctx.bankId },
      data: { isPublic: true },
    });
    const response = await ctx
      .req()
      .get(`/api/practice/banks/${ctx.bankId}/questions`)
      .expect(200);
    const question = responseData<QuestionResponse[]>(response)[0];
    expect(question.images[0].id).toBe(imageId);
    expect(question.images.map((image) => image.optionKey)).toEqual([
      null,
      'C',
      'D',
    ]);
    expect(question).not.toHaveProperty('answer');
    expect(question).not.toHaveProperty('analysis');
    expect(question.translations).not.toHaveProperty('en.answer');
    expect(question.translations).not.toHaveProperty('en.analysis');
  });

  it('prevents cross-question deletion and preserves referenced question images', async () => {
    const before = deleteObject.mock.calls.length;
    await ctx
      .req()
      .delete(`/api/questions/${privateQuestionId}/images/${imageId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await ctx
      .req()
      .delete(`/api/questions/${questionId}/images/${imageId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
    await ctx
      .req()
      .delete(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(400);
    expect(deleteObject.mock.calls.length).toBe(before);
  });

  it('deletes image objects and metadata as a bank editor', async () => {
    const stored = await ctx.prisma.file.findUniqueOrThrow({
      where: { id: imageId },
    });
    await ctx
      .req()
      .delete(`/api/questions/${questionId}/images/${imageId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(deleteObject).toHaveBeenCalledWith(stored.s3Key);
    expect(
      await ctx.prisma.file.findUnique({ where: { id: imageId } }),
    ).toBeNull();
    for (const id of optionImageIds) {
      await ctx
        .req()
        .delete(`/api/questions/${questionId}/images/${id}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(200);
      expect(await ctx.prisma.file.findUnique({ where: { id } })).toBeNull();
    }
  });

  it('cleans S3 images when an unreferenced question is removed and blocks lossy archive overwrite', async () => {
    const response = await imageRequest(privateQuestionId, adminToken).expect(
      201,
    );
    const stored = await ctx.prisma.file.findUniqueOrThrow({
      where: { id: responseData<QuestionImage>(response).id },
    });
    const question = await ctx.prisma.question.findUniqueOrThrow({
      where: { id: privateQuestionId },
    });
    jest
      .spyOn(ctx.app.get(S3Service), 'download')
      .mockResolvedValueOnce(Readable.from([png]));
    const archive = await ctx
      .req()
      .get(`/api/question-banks/${question.bankId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await ctx
      .req()
      .post(`/api/question-banks/${question.bankId}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        archive: {
          ...responseData<BankArchiveDto>(archive),
          meta: { ...responseData<BankArchiveDto>(archive).meta, version: 1 },
          images: undefined,
        },
        mode: 'overwrite',
      })
      .expect(400);
    expect(
      await ctx.prisma.file.findUnique({ where: { id: stored.id } }),
    ).not.toBeNull();
    await ctx
      .req()
      .delete(`/api/questions/${privateQuestionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(deleteObject).toHaveBeenCalledWith(stored.s3Key);
    expect(
      await ctx.prisma.file.findUnique({ where: { id: stored.id } }),
    ).toBeNull();
    expect(
      await ctx.app
        .get(QuestionImagesService)
        .attach([{ id: privateQuestionId }]),
    ).toEqual([{ id: privateQuestionId, images: [] }]);
  });
});
