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
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';

export class GenerateQuestionsDto {
  @ApiProperty({ description: '出题主题/知识点', example: '二叉树遍历' })
  @IsNotEmpty()
  @IsString()
  topic!: string;

  @ApiProperty({ description: '题型', enum: QuestionType })
  @IsEnum(QuestionType)
  type!: QuestionType;

  @ApiProperty({ description: '所属题库ID' })
  @IsUUID()
  bankId!: string;

  @ApiPropertyOptional({ description: '生成数量', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;

  @ApiPropertyOptional({ description: '难度(1-5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '分类ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: '生成语言',
    default: 'zh',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  locale?: string;
}
