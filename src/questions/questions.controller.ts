import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
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
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { QuestionsService } from './questions.service';
import { QuestionImagesService } from '../files/question-images.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { UploadQuestionImageDto } from './dto/upload-question-image.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('题目')
@ApiBearerAuth()
@Controller('questions')
export class QuestionsController {
  constructor(
    private questionsService: QuestionsService,
    private questionImages: QuestionImagesService,
  ) {}

  @Post()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '创建题目' })
  create(
    @Body() dto: CreateQuestionDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.questionsService.create(dto, userId, role);
  }

  @Get()
  @ApiOperation({ summary: '获取题目列表(支持筛选分页)' })
  findAll(
    @Query() query: QueryQuestionDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.questionsService.findAll(query, userId, role);
  }

  @Get('export')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '导出题目为 Excel' })
  @ApiQuery({ name: 'bankId', required: true, description: '题库ID' })
  @ApiQuery({ name: 'categoryId', required: false, description: '按分类筛选' })
  async exportExcel(
    @Query('bankId') bankId: string,
    @Query('categoryId') categoryId: string,
    @Res() res: Response,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    const buffer = await this.questionsService.exportToExcel(
      bankId,
      categoryId,
      userId,
      role,
    );
    res
      .set(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .set('Content-Disposition', 'attachment; filename=questions.xlsx')
      .send(buffer);
  }

  @Post('import')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '从 Excel 导入题目' })
  @ApiQuery({ name: 'bankId', required: true, description: '题库ID' })
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
  importExcel(
    @Query('bankId') bankId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (!file) throw new BadRequestException('请上传文件');
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype}`);
    }
    return this.questionsService.importFromExcel(bankId, file, userId, role);
  }

  @Post(':id/images')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '上传题目图片' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        optionKey: {
          type: 'string',
          description: '关联选项的 key 或 label, 省略表示题干图片',
          example: 'C',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadQuestionImageDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.questionImages.upload(id, file, userId, role, dto.optionKey);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '删除题目图片' })
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.questionImages.remove(id, imageId, userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取题目详情' })
  @ApiQuery({ name: 'locale', required: false, description: '返回内容的语言' })
  findOne(
    @Param('id') id: string,
    @Query('locale') locale?: string,
    @CurrentUser('id') userId?: string,
    @CurrentUser('role') role?: string,
  ) {
    return this.questionsService.findOne(id, locale, userId, role);
  }

  @Patch(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '更新题目' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.questionsService.update(id, dto, userId, role);
  }

  @Delete(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '删除题目' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.questionsService.remove(id, userId, role);
  }
}
