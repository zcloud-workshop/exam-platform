import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryExamDto extends PaginationDto {
  @ApiPropertyOptional({ description: '关键词(搜索考试名称)' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '按题库ID筛选' })
  @IsOptional()
  @IsString()
  bankId?: string;
}
