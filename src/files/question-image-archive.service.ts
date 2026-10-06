import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buffer as readBuffer } from 'node:stream/consumers';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionImagesService } from './question-images.service';
import { S3Service } from './s3.service';
import { QuestionImageArchiveDto } from './dto/question-image-archive.dto';

const IMAGE_SHEET = '_question_images';
const CHUNK_SIZE = 30000;

@Injectable()
export class QuestionImageArchiveService {
  private readonly logger = new Logger(QuestionImageArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly questionImages: QuestionImagesService,
  ) {}

  async export(questionIds: string[]): Promise<QuestionImageArchiveDto[]> {
    if (questionIds.length === 0) return [];
    const files = await this.prisma.file.findMany({
      where: { questionId: { in: questionIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const images: QuestionImageArchiveDto[] = [];
    for (const file of files) {
      let body: Buffer;
      try {
        body = await readBuffer(await this.s3.download(file.s3Key));
      } catch {
        throw new InternalServerErrorException(
          `读取题目图片失败: ${file.originalName}`,
        );
      }
      if (body.length !== file.size) {
        throw new BadRequestException(
          `图片文件大小不一致: ${file.originalName}`,
        );
      }
      this.questionImages.validateImage(body, file.mimeType, null);
      images.push({
        questionId: file.questionId!,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: body.length,
        optionKey: file.optionKey,
        data: body.toString('base64'),
      });
    }
    return images;
  }

  validate(
    images: QuestionImageArchiveDto[],
    questions: Map<string, { options: string | null }>,
  ) {
    for (const image of images) {
      const question = questions.get(image.questionId);
      if (!question) throw new BadRequestException('图片关联的题目不存在');
      this.decode(image, question.options);
    }
  }

  async restore(
    tx: Prisma.TransactionClient,
    images: QuestionImageArchiveDto[],
    questions: Map<string, { id: string; options: string | null }>,
    bankId: string,
    userId: string,
    uploadedKeys: string[],
  ) {
    let imported = 0;
    for (const image of images) {
      const question = questions.get(image.questionId);
      if (!question) continue;
      const { body, extension } = this.decode(image, question.options);
      const key = `question-banks/${bankId}/questions/${question.id}/images/${randomUUID()}.${extension}`;
      uploadedKeys.push(key);
      await this.s3.upload(key, body, image.mimeType);
      await tx.file.create({
        data: {
          originalName: image.originalName,
          mimeType: image.mimeType,
          size: body.length,
          s3Key: key,
          url: null,
          uploadedBy: userId,
          questionId: question.id,
          optionKey: image.optionKey,
        },
      });
      imported++;
    }
    return imported;
  }

  async cleanup(keys: string[]) {
    for (const key of keys) {
      try {
        await this.s3.delete(key);
      } catch {
        this.logger.error(`题库图片清理失败, 需清理 S3 对象: ${key}`);
      }
    }
  }

  async withStorageRollback<T>(
    operation: (uploadedKeys: string[], removedKeys: string[]) => Promise<T>,
  ) {
    const uploadedKeys: string[] = [];
    const removedKeys: string[] = [];
    let result: T;
    try {
      result = await operation(uploadedKeys, removedKeys);
    } catch (error) {
      await this.cleanup(uploadedKeys);
      throw error;
    }
    await this.cleanup(removedKeys);
    return result;
  }

  writeExcel(
    workbook: ExcelJS.Workbook,
    questions: ExcelJS.Worksheet,
    images: QuestionImageArchiveDto[],
  ) {
    if (images.length === 0) return;
    const dataSheet = workbook.addWorksheet(IMAGE_SHEET, {
      state: 'veryHidden',
    });
    dataSheet.addRow([
      'image_archive_v1',
      'questionId',
      'originalName',
      'mimeType',
      'optionKey',
      'part',
      'data',
      'size',
    ]);
    const previews = workbook.addWorksheet('题目图片');
    previews.columns = [
      { header: '题目', key: 'title', width: 40 },
      { header: '文件名', key: 'name', width: 30 },
      { header: '位置', key: 'position', width: 12 },
      { header: '图片', key: 'preview', width: 30 },
    ];
    const titles = new Map<string, string>();
    questions.eachRow((row, index) => {
      if (index > 1) titles.set(row.getCell(12).text, row.getCell(1).text);
    });
    images.forEach((image, index) => {
      for (let offset = 0; offset < image.data.length; offset += CHUNK_SIZE) {
        dataSheet.addRow([
          index,
          image.questionId,
          image.originalName,
          image.mimeType,
          image.optionKey ?? '',
          offset / CHUNK_SIZE,
          image.data.slice(offset, offset + CHUNK_SIZE),
          image.size,
        ]);
      }
      const row = previews.addRow([
        titles.get(image.questionId),
        image.originalName,
        image.optionKey ?? '题干',
      ]);
      const extension =
        image.mimeType === 'image/jpeg'
          ? 'jpeg'
          : image.mimeType === 'image/png'
            ? 'png'
            : image.mimeType === 'image/gif'
              ? 'gif'
              : null;
      if (extension) {
        row.height = 95;
        const id = workbook.addImage({ base64: image.data, extension });
        previews.addImage(id, {
          tl: { col: 3, row: row.number - 1 },
          ext: { width: 160, height: 120 },
        });
      } else {
        row.getCell(4).value = 'WebP 图片随文件保存, 导入后可查看';
      }
    });
  }

  readExcel(
    workbook: ExcelJS.Workbook,
    questions: ExcelJS.Worksheet,
  ): QuestionImageArchiveDto[] {
    const dataSheet = workbook.getWorksheet(IMAGE_SHEET);
    if (!dataSheet) {
      return questions.getImages().map((image) => {
        const row = questions.getRow(image.range.tl.nativeRow + 1);
        const media = workbook.getImage(Number(image.imageId));
        if (!media.buffer) throw new BadRequestException('Excel 图片内容缺失');
        const body = Buffer.from(media.buffer);
        return {
          questionId: this.excelQuestionId(row),
          originalName: `image-${image.imageId}.${media.extension}`,
          mimeType: `image/${media.extension}`,
          size: body.length,
          data: body.toString('base64'),
        };
      });
    }
    if (dataSheet.getCell('A1').text !== 'image_archive_v1') {
      throw new BadRequestException('Excel 图片归档格式无效');
    }
    const images = new Map<
      string,
      { image: QuestionImageArchiveDto; parts: string[] }
    >();
    dataSheet.eachRow((row, index) => {
      if (index === 1) return;
      const id = row.getCell(1).text;
      const image = {
        questionId: row.getCell(2).text,
        originalName: row.getCell(3).text,
        mimeType: row.getCell(4).text,
        size: Number(row.getCell(8).value),
        optionKey: row.getCell(5).text || null,
        data: '',
      };
      const entry = images.get(id) ?? { image, parts: [] };
      if (
        row.getCell(6).value !== entry.parts.length ||
        JSON.stringify(entry.image) !== JSON.stringify(image)
      ) {
        throw new BadRequestException('Excel 图片数据缺失或关联不一致');
      }
      entry.parts.push(row.getCell(7).text);
      images.set(id, entry);
    });
    return [...images.values()].map(({ image, parts }) => ({
      ...image,
      data: parts.join(''),
    }));
  }

  excelQuestionId(row: ExcelJS.Row) {
    return row.getCell(12).text || `row:${row.number}`;
  }

  private decode(image: QuestionImageArchiveDto, options: string | null) {
    if (
      !image.data ||
      image.data.length > Math.ceil((10 * 1024 * 1024) / 3) * 4
    ) {
      throw new BadRequestException('图片不能为空且不能超过 10 MiB');
    }
    const body = Buffer.from(image.data, 'base64');
    if (body.length !== image.size)
      throw new BadRequestException('图片文件大小不一致, 数据可能不完整');
    if (body.toString('base64') !== image.data)
      throw new BadRequestException('图片 Base64 数据无效');
    const extension = this.questionImages.validateImage(
      body,
      image.mimeType,
      options,
      image.optionKey,
    );
    return { body, extension };
  }
}
