import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { retry } from 'rxjs/operators';
import { PrismaService, isConnectionError } from '../../prisma/prisma.service';

/** 幂等 HTTP 方法: 仅这些方法的请求才会在断线重连后自动重试 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 查询级透明重连拦截器:
 * 当 handler 抛出"连接可恢复"类 Prisma 错误时,
 * 调 prismaService.reconnect() 重建连接池, 然后重试请求 1 次。
 *
 * 仅对幂等方法 (GET/HEAD/OPTIONS) 重试, 避免写操作在重连后重复写入。
 * 注册为 APP_INTERCEPTOR 且排在 OperationLogInterceptor 之后 (更内层),
 * 使重连重试发生在日志 tap 的内层, 操作日志不会因重试而重复记录。
 */
@Injectable()
export class PrismaReconnectInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const method = context
      .switchToHttp()
      .getRequest<{ method: string }>().method;
    const idempotent = IDEMPOTENT_METHODS.has(method);

    return next.handle().pipe(
      retry({
        count: 1,
        delay: async (error) => {
          // 非连接错误 或 非幂等方法: 终止重试, 把错误原样传递 (不吞错)
          if (!isConnectionError(error) || !idempotent) {
            throw error;
          }
          // 重建连接池; Promise resolve 后 rxjs 重新订阅 next.handle() = 重新执行 handler
          await this.prisma.reconnect();
        },
      }),
    );
  }
}
