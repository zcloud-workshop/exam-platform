import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, type File } from '@prisma/client';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';

export type QuestionImage = Pick<
  File,
  'id' | 'originalName' | 'mimeType' | 'size' | 'optionKey'
> & { url: string; expiresAt: string };

@Injectable()
export class QuestionImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankPermission: BankPermissionService,
    private readonly files: FilesService,
    private readonly s3: S3Service,
  ) {}

  async upload(
    questionId: string,
    file: Express.Multer.File,
    userId: string,
    role: string,
    optionKey?: string,
  ): Promise<QuestionImage> {
    const question = await this.requireEditor(questionId, userId, role);
    if (!file) throw new BadRequestException('请上传图片');
    const extension = this.validateImage(
      file.buffer,
      file.mimetype,
      question.options,
      optionKey,
    );
    const image = await this.files.upload(file, userId, {
      id: question.id,
      bankId: question.bankId,
      extension,
      optionKey,
    });
    return this.signImage(image);
  }

  validateImage(
    buffer: Buffer,
    mimeType: string,
    questionOptions: string | null,
    optionKey?: string | null,
  ) {
    if (optionKey !== undefined && optionKey !== null) {
      let options: unknown;
      try {
        options = JSON.parse(questionOptions ?? 'null');
      } catch {
        throw new BadRequestException('题目选项格式无效');
      }
      const exists = Array.isArray(options)
        ? options.some(
            (option: unknown) =>
              option !== null &&
              typeof option === 'object' &&
              'label' in option &&
              option.label === optionKey,
          )
        : options !== null &&
          typeof options === 'object' &&
          Object.prototype.hasOwnProperty.call(options, optionKey);
      if (!exists) throw new BadRequestException(`选项 ${optionKey} 不存在`);
    }
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('图片不能为空且不能超过 10 MiB');
    }
    return this.getImageExtension({ buffer, mimetype: mimeType });
  }

  async remove(
    questionId: string,
    imageId: string,
    userId: string,
    role: string,
  ) {
    await this.requireEditor(questionId, userId, role);
    const image = await this.prisma.file.findUnique({ where: { id: imageId } });
    if (!image || image.questionId !== questionId) {
      throw new NotFoundException('题目图片不存在');
    }
    await this.files.remove(imageId);
    return { id: imageId };
  }

  async removeForQuestion(questionId: string) {
    const images = await this.prisma.file.findMany({
      where: { questionId },
      select: { id: true },
    });
    for (const image of images) await this.files.remove(image.id);
  }

  async attach<T extends { id: string }>(
    questions: T[],
  ): Promise<(T & { images: QuestionImage[] })[]> {
    if (questions.length === 0) return [];
    const files = await this.prisma.file.findMany({
      where: { questionId: { in: [...new Set(questions.map((q) => q.id))] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const signedImages = await Promise.all(
      files.map(async (file) => ({
        questionId: file.questionId!,
        image: await this.signImage(file),
      })),
    );
    const imagesByQuestion = new Map<string, QuestionImage[]>();
    for (const { questionId, image } of signedImages) {
      const images = imagesByQuestion.get(questionId) ?? [];
      images.push(image);
      imagesByQuestion.set(questionId, images);
    }
    return questions.map((question) => ({
      ...question,
      images: imagesByQuestion.get(question.id) ?? [],
    }));
  }

  async attachToPapers<T extends { questions: { question: { id: string } }[] }>(
    papers: T[],
  ) {
    const questions = await this.attach(
      papers.flatMap((paper) => paper.questions.map((link) => link.question)),
    );
    const imagesByQuestion = new Map(
      questions.map((question) => [question.id, question.images]),
    );
    return papers.map((paper) => ({
      ...paper,
      questions: paper.questions.map((link) => ({
        ...link,
        question: {
          ...link.question,
          images: imagesByQuestion.get(link.question.id) ?? [],
        },
      })),
    }));
  }

  private async signImage(
    file: Pick<
      File,
      'id' | 'originalName' | 'mimeType' | 'size' | 's3Key' | 'optionKey'
    >,
  ): Promise<QuestionImage> {
    const { id, originalName, mimeType, size, optionKey } = file;
    return {
      id,
      originalName,
      mimeType,
      size,
      optionKey,
      ...(await this.s3.presignGetObject(file.s3Key)),
    };
  }

  private async requireEditor(id: string, userId: string, role: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      select: { id: true, bankId: true, options: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        question.bankId,
        'editor',
      );
    }
    return question;
  }

  private getImageExtension(
    file: Pick<Express.Multer.File, 'buffer' | 'mimetype'>,
  ) {
    const buffer = file.buffer;
    switch (file.mimetype) {
      case 'image/png':
        if (
          buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        ) {
          return 'png';
        }
        break;
      case 'image/jpeg':
        if (buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
          return 'jpg';
        }
        break;
      case 'image/gif':
        if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
          return 'gif';
        }
        break;
      case 'image/webp':
        if (
          buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP'
        ) {
          return 'webp';
        }
        break;
    }
    throw new BadRequestException(
      '仅支持内容与 MIME 一致的 PNG/JPEG/GIF/WebP 图片',
    );
  }
}
