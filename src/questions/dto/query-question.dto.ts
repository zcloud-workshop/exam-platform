import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryQuestionDto extends PaginationDto {
  @ApiPropertyOptional({ description: '题库ID' })
  @IsOptional()
  @IsUUID()
  bankId?: string;

  @ApiPropertyOptional({ description: '题型', enum: QuestionType })
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @ApiPropertyOptional({ description: '分类ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: '难度' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  difficulty?: number;

  @ApiPropertyOptional({ description: '关键词(搜索标题)' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '返回内容的语言, 无翻译时回退到主语言' })
  @IsOptional()
  @IsString()
  locale?: string;
}
