import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import { PracticeService } from './practice.service';
import { CheckAnswerDto } from './dto/check-answer.dto';
import { QueryPracticeDto } from './dto/query-practice.dto';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

@ApiTags('练题')
@Public()
@UseGuards(OptionalJwtAuthGuard)
@Controller('practice')
export class PracticeController {
  constructor(private readonly service: PracticeService) {}

  @Get('banks')
  @ApiOperation({ summary: '获取公开题库列表' })
  getPublicBanks() {
    return this.service.getPublicBanks();
  }

  @Get('banks/:bankId/questions')
  @ApiOperation({ summary: '获取题目列表(不含答案)' })
  getQuestions(
    @Param('bankId') bankId: string,
    @Query('mode') mode: 'random' | 'sequential' = 'sequential',
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.getQuestions(bankId, mode, user?.id);
  }

  @Get('banks/:bankId/question-pages')
  @ApiOperation({ summary: '分页获取和搜索练习题目(不含答案)' })
  getQuestionPage(
    @Param('bankId') bankId: string,
    @Query() query: QueryPracticeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.getQuestionPage(bankId, query, user?.id);
  }

  @Get('banks/:bankId/questions/:questionId')
  @ApiOperation({ summary: '获取单道练习题目(不含答案)' })
  getQuestion(
    @Param('bankId') bankId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.getQuestion(bankId, questionId, user?.id);
  }

  @Post('banks/:bankId/questions/:questionId/check')
  @ApiOperation({ summary: '提交答案并获取正确结果' })
  checkAnswer(
    @Param('bankId') bankId: string,
    @Param('questionId') questionId: string,
    @Body() dto: CheckAnswerDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.checkAnswer(bankId, questionId, dto, user?.id);
  }

  @Put('banks/:bankId/questions/:questionId/favorite')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: '收藏练习题目' })
  addFavorite(
    @Param('bankId') bankId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setFavorite(bankId, questionId, user.id, true);
  }

  @Delete('banks/:bankId/questions/:questionId/favorite')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: '取消收藏练习题目' })
  removeFavorite(
    @Param('bankId') bankId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setFavorite(bankId, questionId, user.id, false);
  }
}
