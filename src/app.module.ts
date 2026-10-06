import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { QuestionsModule } from './questions/questions.module';
import { PapersModule } from './papers/papers.module';
import { ExamsModule } from './exams/exams.module';
import { RecordsModule } from './records/records.module';
import { LogsModule } from './logs/logs.module';
import { FilesModule } from './files/files.module';
import { AiModule } from './ai/ai.module';
import { QuestionBanksModule } from './question-banks/question-banks.module';
import { PracticeModule } from './practice/practice.module';
import { CommonModule } from './common/common.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { OperationLogInterceptor } from './common/interceptors/operation-log.interceptor';
import { PrismaReconnectInterceptor } from './common/interceptors/prisma-reconnect.interceptor';

/**
 * 根模块
 * 通过 APP_GUARD 全局注册 JWT 认证守卫和角色守卫
 * 通过 APP_INTERCEPTOR 全局注册操作日志拦截器
 * 守卫执行顺序: JwtAuthGuard (认证) -> RolesGuard (授权)
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    QuestionsModule,
    PapersModule,
    ExamsModule,
    RecordsModule,
    LogsModule,
    FilesModule,
    AiModule,
    QuestionBanksModule,
    PracticeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PrismaReconnectInterceptor },
  ],
})
export class AppModule {}
