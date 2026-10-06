import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { LogsService } from './logs.service';
import { QueryLogDto } from './dto/query-log.dto';

@ApiTags('操作日志')
@ApiBearerAuth()
@Controller('logs')
@Roles(Role.super_admin)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @ApiOperation({ summary: '查询操作日志' })
  findAll(@Query() query: QueryLogDto) {
    return this.logsService.findAll(query);
  }
}
