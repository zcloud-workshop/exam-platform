import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExamsService } from './exams.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

/**
 * 考试控制器
 * super_admin/question_admin/teacher 可管理考试, 所有认证用户可查看
 */
@ApiTags('考试')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(private examsService: ExamsService) {}

  @Post()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '创建考试' })
  create(
    @Body() dto: CreateExamDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.examsService.create(dto, userId, role);
  }

  @Get()
  @ApiOperation({ summary: '获取考试列表' })
  findAll(
    @Query() query: QueryExamDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.examsService.findAll(query, userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取考试详情(含试卷和题目)' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.examsService.findOne(id, userId, role);
  }

  @Patch(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '更新考试' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.examsService.update(id, dto, userId, role);
  }

  @Delete(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '删除考试' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.examsService.remove(id, userId, role);
  }
}
