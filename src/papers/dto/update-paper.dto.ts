import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsArray,
  IsUUID,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePaperDto {
  @ApiPropertyOptional({ description: '试卷名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '考试时长(分钟)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ description: '总分' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalScore?: number;

  @ApiPropertyOptional({ description: '题目ID列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  questionIds?: string[];
}
