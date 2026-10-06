import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  QueryPracticeCollectionDto,
  QueryPracticeHistoryDto,
} from './dto/query-personal-practice.dto';
import { PracticeService } from './practice.service';

@ApiTags('我的练习')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('practice/mine')
export class PersonalPracticeController {
  constructor(private readonly service: PracticeService) {}

  @Get('summary')
  @ApiOperation({ summary: '我的练习统计' })
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSummary(user.id);
  }

  @Get('questions')
  @ApiOperation({ summary: '分页获取我的错题或收藏' })
  getQuestions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryPracticeCollectionDto,
  ) {
    return this.service.getCollection(user.id, query);
  }

  @Get('records')
  @ApiOperation({ summary: '分页获取我的练习记录' })
  getRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryPracticeHistoryDto,
  ) {
    return this.service.getHistory(user.id, query);
  }

  @Delete('wrong-questions/:questionId')
  @ApiOperation({ summary: '从我的错题本中移除题目' })
  removeWrongQuestion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId') questionId: string,
  ) {
    return this.service.removeWrongQuestion(questionId, user.id);
  }
}
