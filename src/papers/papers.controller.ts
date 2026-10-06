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
import { PapersService } from './papers.service';
import { CreatePaperDto } from './dto/create-paper.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';
import { QueryPaperDto } from './dto/query-paper.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

/**
 * 试卷控制器
 * super_admin/question_admin/teacher 可管理试卷, 所有认证用户可查看
 */
@ApiTags('试卷')
@ApiBearerAuth()
@Controller('papers')
export class PapersController {
  constructor(private papersService: PapersService) {}

  @Post()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '创建试卷' })
  create(
    @Body() dto: CreatePaperDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.papersService.create(dto, userId, role);
  }

  @Get()
  @ApiOperation({ summary: '获取试卷列表' })
  findAll(
    @Query() query: QueryPaperDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.papersService.findAll(query, userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取试卷详情(含题目)' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.papersService.findOne(id, userId, role);
  }

  @Patch(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '更新试卷' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaperDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.papersService.update(id, dto, userId, role);
  }

  @Delete(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '删除试卷' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.papersService.remove(id, userId, role);
  }
}
