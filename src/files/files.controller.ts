import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { FilesService } from './files.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('文件管理')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '上传文件' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId?: string,
  ) {
    if (!file) throw new BadRequestException('请上传文件');

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/zip',
      'application/x-tar',
      'application/gzip',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype}`);
    }

    return this.filesService.upload(file, userId);
  }

  @Get()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '获取文件列表' })
  findAll(
    @Query() query: PaginationDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.filesService.findAll(query, userId, role);
  }

  @Get(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '下载文件' })
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    const { stream, file } = await this.filesService.download(id, userId, role);
    res
      .set('Content-Type', file.mimeType)
      .set(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      );
    stream.pipe(res);
  }

  @Delete(':id')
  @Roles(Role.super_admin, Role.question_admin)
  @ApiOperation({ summary: '删除文件' })
  remove(@Param('id') id: string) {
    return this.filesService.remove(id);
  }
}
