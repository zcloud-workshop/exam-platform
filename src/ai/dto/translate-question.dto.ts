import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { SUPPORTED_LOCALES } from '../../common/utils/localize';

/** AI 题目翻译入参: 目标语言必须与主语言不同 */
export class TranslateQuestionDto {
  @ApiProperty({
    description: '目标翻译语言 (需与题目主语言不同)',
    enum: SUPPORTED_LOCALES,
    example: 'en',
  })
  @IsNotEmpty()
  @IsIn(SUPPORTED_LOCALES)
  targetLocale!: string;
}
