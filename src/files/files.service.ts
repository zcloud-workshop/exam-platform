import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';
import { PaginatedResult } from '../common/types/pagination';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Role, type File } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async upload(
    file: Express.Multer.File,
    userId?: string,
    question?: {
      id: string;
      bankId: string;
      extension: string;
      optionKey?: string;
    },
  ) {
    const key = question
      ? `question-banks/${question.bankId}/questions/${question.id}/images/${randomUUID()}.${question.extension}`
      : `files/${randomUUID()}/${file.originalname}`;
    await this.s3Service.upload(key, file.buffer, file.mimetype);

    try {
      return await this.prisma.file.create({
        data: {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          s3Key: key,
          url: question ? null : this.s3Service.getPublicUrl(key),
          uploadedBy: userId,
          questionId: question?.id,
          optionKey: question?.optionKey,
        },
      });
    } catch (error) {
      try {
        await this.s3Service.delete(key);
      } catch {
        this.logger.error(`上传回滚失败, 需清理 S3 对象: ${key}`);
      }
      throw error;
    }
  }

  async download(
    id: string,
    userId: string,
    role: string,
  ): Promise<{ stream: Readable; file: File }> {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('文件不存在');
    this.ensureFileAccess(file, userId, role);

    const stream = await this.s3Service.download(file.s3Key);
    return { stream, file };
  }

  async remove(id: string) {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('文件不存在');

    await this.s3Service.delete(file.s3Key);
    return this.prisma.file.delete({ where: { id } });
  }

  async findAll(
    query: PaginationDto,
    userId: string,
    role: string,
  ): Promise<PaginatedResult<File>> {
    const { page = 1, pageSize = 20 } = query;
    const where =
      role === Role.super_admin || role === Role.question_admin
        ? {}
        : { uploadedBy: userId };

    const [data, total] = await Promise.all([
      this.prisma.file.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.file.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  private ensureFileAccess(
    file: { uploadedBy: string | null },
    userId: string,
    role: string,
  ) {
    if (role === Role.super_admin || role === Role.question_admin) return;
    if (file.uploadedBy === userId) return;
    throw new ForbiddenException('无权访问该文件');
  }
}
