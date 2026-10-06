import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: '分类名称', example: '数学' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ description: '所属题库ID' })
  @IsUUID()
  bankId!: string;

  @ApiPropertyOptional({ description: '父分类ID' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
