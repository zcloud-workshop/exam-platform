import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject } from 'class-validator';

/** 提交答案 DTO, key 为题目 ID, value 为学生答案 */
export class SubmitAnswerDto {
  @ApiProperty({
    description: '答案, key 为题目ID, value 为答案',
    example: { 'question-id-1': 'A', 'question-id-2': 'B,C' },
  })
  @IsNotEmpty()
  @IsObject()
  answers!: { [key: string]: string };
}
