import { Controller, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { GenerateQuestionsDto } from './dto/generate-questions.dto';
import { RulePaperDto, AiPaperDto } from './dto/smart-paper.dto';
import { TranslateQuestionDto } from './dto/translate-question.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

/** AI 智能助手控制器, 提供自动出题/解析生成/智能组卷 */
@ApiTags('AI 智能助手')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('questions')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: 'AI 自动出题' })
  generateQuestions(
    @Body() dto: GenerateQuestionsDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.aiService.generateQuestions(dto, userId, role);
  }

  @Post('analysis/:id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: 'AI 生成题目解析' })
  generateAnalysis(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.aiService.generateAnalysis(id, userId, role);
  }

  @Post('translate/:id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: 'AI 翻译题目 (返回草稿, 不写库)' })
  translateQuestion(
    @Param('id') id: string,
    @Body() dto: TranslateQuestionDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.aiService.translateQuestion(id, dto, userId, role);
  }

  @Post('smart-paper/rule')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '规则组卷 (按难度/分类/题型规则抽取)' })
  rulePaperCompose(
    @Body() dto: RulePaperDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.aiService.rulePaperCompose(dto, userId, role);
  }

  @Post('smart-paper/ai')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: 'AI 智能组卷' })
  aiPaperCompose(
    @Body() dto: AiPaperDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.aiService.aiPaperCompose(dto, userId, role);
  }
}
