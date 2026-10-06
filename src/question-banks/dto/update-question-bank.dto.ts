import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';
import { CreateQuestionBankDto } from './create-question-bank.dto';

export class UpdateQuestionBankDto extends PartialType(CreateQuestionBankDto) {
  @ApiPropertyOptional({ description: '转移题库的目标用户 ID' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  createdBy?: string;
}
