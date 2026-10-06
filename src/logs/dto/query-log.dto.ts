import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryLogDto extends PaginationDto {
  @ApiPropertyOptional({ description: '用户ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: '用户名 (模糊匹配)' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    description: '操作类型',
    enum: ['CREATE', 'UPDATE', 'DELETE'],
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: '资源类型', example: 'questions' })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ description: '开始日期 (ISO 格式)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期 (ISO 格式)' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
