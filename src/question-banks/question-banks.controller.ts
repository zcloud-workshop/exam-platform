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
import { QuestionBanksService } from './question-banks.service';
import { BankArchiveService } from './bank-archive.service';
import { CreateQuestionBankDto } from './dto/create-question-bank.dto';
import { UpdateQuestionBankDto } from './dto/update-question-bank.dto';
import { QueryQuestionBankDto } from './dto/query-question-bank.dto';
import { CreateShareDto } from './dto/create-share.dto';
import {
  CreateBankArchiveDto,
  ImportBankArchiveDto,
} from './dto/bank-archive.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('question-banks')
export class QuestionBanksController {
  constructor(
    private readonly service: QuestionBanksService,
    private readonly archiveService: BankArchiveService,
  ) {}

  @Post()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  create(
    @Body() dto: CreateQuestionBankDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  @Get()
  findAll(
    @Query() query: QueryQuestionBankDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.findAll(query, userId, role);
  }

  @Patch(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionBankDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.update(id, dto, userId, role);
  }

  @Delete(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.remove(id, userId, role);
  }

  // --- 归档导出/导入端点 ---

  @Post('import')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  createFromArchive(
    @Body() dto: CreateBankArchiveDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.archiveService.createFromArchive(dto.archive, userId, dto.name);
  }

  /** 导出整个题库为 JSON 归档 (分类树 + 完整题目), 用于独立备份/迁移 */
  @Get(':id/export')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  export(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.archiveService.export(id, userId, role);
  }

  /** 将归档导入到指定题库, 支持 mode: skip(默认) | overwrite | merge */
  @Post(':id/import')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  import(
    @Param('id') id: string,
    @Body() dto: ImportBankArchiveDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.archiveService.import(id, dto.archive, dto.mode, userId, role);
  }

  // --- Share endpoints ---

  @Post(':id/shares')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  addShare(
    @Param('id') bankId: string,
    @Body() dto: CreateShareDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.addShare(bankId, dto, userId, role);
  }

  @Get(':id/shares')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  listShares(
    @Param('id') bankId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.listShares(bankId, userId, role);
  }

  @Delete(':id/shares/:shareId')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  removeShare(
    @Param('id') bankId: string,
    @Param('shareId') shareId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.removeShare(bankId, shareId, userId, role);
  }
}
