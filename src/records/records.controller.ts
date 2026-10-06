import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RecordsService } from './records.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

/**
 * 答题记录控制器
 * 学生提交答案和查看自己成绩, 教师查看所有成绩和统计
 */
@ApiTags('答题记录')
@ApiBearerAuth()
@Controller('exams/:examId/records')
export class RecordsController {
  constructor(private recordsService: RecordsService) {}

  @Post()
  @Roles(Role.student)
  @ApiOperation({ summary: '提交答案' })
  submit(
    @Param('examId') examId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.recordsService.submit(examId, userId, dto);
  }

  @Put('draft')
  @Roles(Role.student)
  @ApiOperation({ summary: '保存草稿答案' })
  saveDraft(
    @Param('examId') examId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SaveDraftDto,
  ) {
    return this.recordsService.saveDraft(examId, userId, dto);
  }

  @Get('draft')
  @Roles(Role.student)
  @ApiOperation({ summary: '获取草稿(用于恢复答题)' })
  getDraft(@Param('examId') examId: string, @CurrentUser('id') userId: string) {
    return this.recordsService.getDraft(examId, userId);
  }

  @Get()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '查看所有成绩(教师)' })
  findAll(
    @Param('examId') examId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @CurrentUser('id') userId?: string,
    @CurrentUser('role') role?: string,
  ) {
    return this.recordsService.findAll(examId, userId!, role!, page, pageSize);
  }

  @Get('stats')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '成绩统计' })
  getStats(
    @Param('examId') examId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.recordsService.getStats(examId, userId, role);
  }
}
