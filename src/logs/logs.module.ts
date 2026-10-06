import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { OperationLogInterceptor } from '../common/interceptors/operation-log.interceptor';

@Module({
  controllers: [LogsController],
  providers: [LogsService, OperationLogInterceptor],
  exports: [OperationLogInterceptor],
})
export class LogsModule {}
