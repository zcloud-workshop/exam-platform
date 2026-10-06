import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';

/** 规则组卷的单条规则 */
export class PaperRuleDto {
  @ApiPropertyOptional({ description: '分类ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: '题型', enum: QuestionType })
  @IsOptional()
  @IsString()
  type?: QuestionType;

  @ApiPropertyOptional({ description: '难度(1-5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  difficulty?: number;

  @ApiProperty({ description: '题目数量' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count!: number;

  @ApiProperty({ description: '每题分值' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  scorePerQuestion!: number;
}

/** 规则组卷请求 */
export class RulePaperDto {
  @ApiProperty({ description: '试卷名称' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ description: '考试时长(分钟)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration!: number;

  @ApiProperty({ description: '总分' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalScore!: number;

  @ApiProperty({ description: '所属题库ID' })
  @IsUUID()
  bankId!: string;

  @ApiProperty({ description: '组卷规则列表', type: [PaperRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaperRuleDto)
  rules!: PaperRuleDto[];
}

/** AI 组卷请求 */
export class AiPaperDto {
  @ApiProperty({ description: '试卷名称' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ description: '考试时长(分钟)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration!: number;

  @ApiProperty({ description: '总分' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalScore!: number;

  @ApiProperty({ description: '所属题库ID' })
  @IsUUID()
  bankId!: string;

  @ApiProperty({ description: '科目/主题' })
  @IsNotEmpty()
  @IsString()
  subject!: string;

  @ApiPropertyOptional({ description: '难度偏好描述', example: '中等偏难' })
  @IsOptional()
  @IsString()
  difficultyPreference?: string;

  @ApiPropertyOptional({ description: '限定分类ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
