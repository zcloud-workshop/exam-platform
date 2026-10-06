import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryPaperDto extends PaginationDto {
  @ApiPropertyOptional({ description: '题库ID' })
  @IsOptional()
  @IsUUID()
  bankId?: string;

  @ApiPropertyOptional({ description: '关键词(搜索试卷名称)' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
