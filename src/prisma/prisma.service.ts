import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/** 连接可恢复类 Prisma 错误码 (见官方 error-reference): 重试/重连才有意义 */
const RECOVERABLE_CODES = new Set([
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1017',
]);

/** 判断错误是否为"连接可恢复"类: 仅这类错误值得重试或重连 */
export function isConnectionError(err: unknown): boolean {
  // PrismaClientInitializationError: 引擎建连阶段出错, 错误码在 errorCode 上
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return RECOVERABLE_CODES.has(err.errorCode ?? '');
  }
  // PrismaClientKnownRequestError: 查询期已知错误, 错误码在 code 上
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return RECOVERABLE_CODES.has(err.code);
  }
  // RustPanic (需重启进程) / UnknownRequestError (无 code) / 其他: 不重连
  return false;
}

/** Prisma 数据库服务, 管理 PostgreSQL 连接池生命周期 + 断线重连 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  /** 并发重联合并: 同一时刻只允许一次重建, 其余 await 同一个 Promise */
  private reconnectInFlight: Promise<void> | null = null;

  constructor() {
    super({
      // 单实例直连部署: 连接池大小由 DATABASE_URL 的 connection_limit 控制
      // (与 PG max_connections 协调, 留余量给迁移/备份/监控会话);
      // 此处显式传入 url, 保证运行时与 CLI(migrate/seed)共用同一份连接配置。
      log: ['warn', 'error'],
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }

  /** 应用启动时建立连接池 (带退避重试, DB 未就绪不直接崩) */
  async onModuleInit() {
    await this.connectWithRetry();
    this.logger.log('PostgreSQL 连接池已建立');
  }

  /** 应用关闭时释放连接池 */
  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('PostgreSQL 连接池已关闭');
  }

  /** 启动期指数退避重试 (base 1s, 最多 5 次, 总上限 ~31s); 仅对连接类错误重试 */
  private async connectWithRetry(
    maxRetries = 5,
    baseDelayMs = 1000,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect();
        return;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && isConnectionError(err)) {
          const delay = baseDelayMs * 2 ** (attempt - 1);
          this.logger.warn(
            `$connect() 第 ${attempt}/${maxRetries} 次失败, ${delay}ms 后重试: ${(err as Error).message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          break; // 非连接错误 (如认证失败) 或已达上限, 交给 Nest 启动失败
        }
      }
    }
    throw lastError;
  }

  /**
   * 查询期透明重连 (并发安全): 多个请求同时命中连接错误时,
   * 只执行一次 $disconnect()+$connect(), 其余 await 同一个 in-flight Promise。
   */
  async reconnect(): Promise<void> {
    if (this.reconnectInFlight) {
      return this.reconnectInFlight;
    }
    this.reconnectInFlight = (async () => {
      try {
        this.logger.warn('检测到连接错误, 正在重建连接池...');
        await this.$disconnect().catch((e: Error) =>
          this.logger.warn(`$disconnect() 忽略错误: ${e.message}`),
        );
        await this.$connect();
        this.logger.log('连接池已重建');
      } finally {
        this.reconnectInFlight = null;
      }
    })();
    return this.reconnectInFlight;
  }
}
