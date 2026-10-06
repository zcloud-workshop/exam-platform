import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
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

export class CreateQuestionDto {
  @ApiProperty({ description: '题目标题' })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiProperty({ description: '题型', enum: QuestionType })
  @IsEnum(QuestionType)
  type!: QuestionType;

  @ApiProperty({ description: '所属题库ID' })
  @IsUUID()
  bankId!: string;

  @ApiPropertyOptional({ description: '选项(JSON), 用于单选/多选/判断题' })
  @IsOptional()
  options?: unknown;

  @ApiProperty({ description: '答案' })
  @IsNotEmpty()
  @IsString()
  answer!: string;

  @ApiPropertyOptional({ description: '解析' })
  @IsOptional()
  @IsString()
  analysis?: string;

  @ApiPropertyOptional({ description: '难度(1-5)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '分值', default: 1 })
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
    default: 'zh',
    enum: SUPPORTED_LOCALES,
  })
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LOCALES)
  locale?: string;

  @ApiPropertyOptional({
    description: '其他语言翻译, key 为语言代码',
    example: { en: { title: 'What is 1+1?', answer: '2' } },
  })
  @IsOptional()
  translations?: { [locale: string]: QuestionTranslationDto };
}
