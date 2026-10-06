import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadQuestionImageDto {
  @ApiPropertyOptional({
    description: '关联选项的 key 或 label, 省略表示题干图片',
    example: 'C',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  optionKey?: string;
}
