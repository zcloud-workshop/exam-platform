import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryPracticeDto extends PaginationDto {
  @ApiPropertyOptional({ description: '每页数量', default: 50, maximum: 100 })
  override pageSize?: number = 50;

  @ApiPropertyOptional({
    enum: ['sequential', 'random'],
    default: 'sequential',
  })
  @IsOptional()
  @IsIn(['sequential', 'random'])
  mode?: 'sequential' | 'random';

  @ApiPropertyOptional({ description: '搜索题干、选项及翻译内容' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '本次练习的随机排序种子' })
  @IsOptional()
  @IsString()
  seed?: string;

  @ApiPropertyOptional({
    description: '仅练习本人的错题或收藏',
    enum: ['wrong', 'favorites'],
  })
  @IsOptional()
  @IsIn(['wrong', 'favorites'])
  collection?: 'wrong' | 'favorites';

  @ApiPropertyOptional({ description: '定位到指定题目所在的分页' })
  @IsOptional()
  @IsString()
  questionId?: string;
}
