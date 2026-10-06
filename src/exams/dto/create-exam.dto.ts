import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateExamDto {
  @ApiProperty({ description: '考试名称', example: '数学期中考试 - 第一场' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ description: '试卷ID' })
  @IsNotEmpty()
  @IsUUID()
  paperId!: string;

  @ApiProperty({ description: '开始时间', example: '2026-06-10T09:00:00Z' })
  @IsNotEmpty()
  @IsDateString()
  startTime!: string;

  @ApiProperty({ description: '结束时间', example: '2026-06-10T11:00:00Z' })
  @IsNotEmpty()
  @IsDateString()
  endTime!: string;

  @ApiProperty({
    description: '交卷后是否显示分数',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  showScore?: boolean;

  @ApiProperty({
    description: '允许参加考试的学生ID列表',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  studentIds?: string[];
}
