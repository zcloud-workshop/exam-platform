import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../types/authenticated-request';

const logger = new Logger('OperationLog');

const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'CREATE',
  PATCH: 'UPDATE',
  PUT: 'UPDATE',
  DELETE: 'DELETE',
};

const PATH_REGEX = /^\/api\/([^/]+)(?:\/([^/]+))?/;

/** 操作日志拦截器, 记录 POST/PATCH/PUT/DELETE 请求 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const method: string = req.method;

    if (!METHOD_ACTION_MAP[method]) {
      return next.handle();
    }

    const user = req.user;
    const match = PATH_REGEX.exec(req.path);
    const resource = match?.[1] ?? null;
    const resourceId = match?.[2] ?? null;
    const action = METHOD_ACTION_MAP[method];

    return next.handle().pipe(
      tap(() => {
        const logMsg = `${action} ${resource}${resourceId ? '/' + resourceId : ''} by ${user?.username ?? 'anonymous'} ${req.path} ${req.ip ?? ''}`;

        logger.log(logMsg);

        this.prisma.operationLog
          .create({
            data: {
              userId: user?.id ?? null,
              username: user?.username ?? null,
              action,
              resource,
              resourceId,
              method,
              path: req.path,
              ip: req.ip ?? null,
              userAgent: req.headers['user-agent'] ?? null,
            },
          })
          .catch((err: unknown) => {
            logger.error(
              '操作日志写入失败',
              err instanceof Error ? err.message : String(err),
            );
          });
      }),
    );
  }
}
