import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsArray,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaperDto {
  @ApiProperty({ description: '试卷名称', example: '数学期中考试' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ description: '考试时长(分钟)', example: 120 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration!: number;

  @ApiProperty({ description: '总分', example: 100 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalScore!: number;

  @ApiProperty({ description: '所属题库ID' })
  @IsUUID()
  bankId!: string;

  @ApiProperty({ description: '题目ID列表', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  questionIds!: string[];
}
