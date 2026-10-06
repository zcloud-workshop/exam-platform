import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryPracticeHistoryDto extends PaginationDto {
  @ApiPropertyOptional({ description: '按题库筛选' })
  @IsOptional()
  @IsString()
  bankId?: string;
}

export class QueryPracticeCollectionDto extends QueryPracticeHistoryDto {
  @ApiProperty({ enum: ['wrong', 'favorites'] })
  @IsIn(['wrong', 'favorites'])
  collection!: 'wrong' | 'favorites';
}
