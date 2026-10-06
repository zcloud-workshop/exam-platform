import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

/** 单个语言的翻译块, title 必填, 其余可选 */
export class QuestionTranslationDto {
  @ApiProperty({ description: '翻译后的标题' })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiPropertyOptional({ description: '翻译后的选项' })
  @IsOptional()
  options?: unknown;

  @ApiPropertyOptional({ description: '翻译后的答案' })
  @IsOptional()
  @IsString()
  answer?: string;

  @ApiPropertyOptional({ description: '翻译后的解析' })
  @IsOptional()
  @IsString()
  analysis?: string;
}
