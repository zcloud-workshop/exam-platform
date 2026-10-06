import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsInt,
  IsUUID,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';
import { QuestionTranslationDto } from './translation.dto';
import { SUPPORTED_LOCALES } from '../../common/utils/localize';

export class UpdateQuestionDto {
  @ApiPropertyOptional({ description: '题目标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '题型', enum: QuestionType })
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @ApiPropertyOptional({ description: '选项(JSON)' })
  @IsOptional()
  options?: unknown;

  @ApiPropertyOptional({ description: '答案' })
  @IsOptional()
  @IsString()
  answer?: string;

  @ApiPropertyOptional({ description: '解析' })
  @IsOptional()
  @IsString()
  analysis?: string;

  @ApiPropertyOptional({ description: '难度(1-5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '分值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  score?: number;

  @ApiPropertyOptional({ description: '分类ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: '主内容语言 (zh 中文 / en 英语)',
    enum: SUPPORTED_LOCALES,
  })
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LOCALES)
  locale?: string;

  @ApiPropertyOptional({ description: '其他语言翻译' })
  @IsOptional()
  translations?: { [locale: string]: QuestionTranslationDto };
}
