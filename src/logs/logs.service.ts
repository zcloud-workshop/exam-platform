import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLogDto } from './dto/query-log.dto';
import { PaginatedResult } from '../common/types/pagination';

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryLogDto): Promise<PaginatedResult<any>> {
    const {
      page = 1,
      pageSize = 20,
      userId,
      username,
      action,
      resource,
      startDate,
      endDate,
    } = query;

    const where: Prisma.OperationLogWhereInput = {};

    if (userId) where.userId = userId;
    if (username) where.username = { contains: username };
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }
}
