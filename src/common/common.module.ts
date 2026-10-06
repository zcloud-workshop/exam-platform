import { Global, Module } from '@nestjs/common';
import { BankPermissionService } from './services/bank-permission.service';

@Global()
@Module({
  providers: [BankPermissionService],
  exports: [BankPermissionService],
})
export class CommonModule {}
