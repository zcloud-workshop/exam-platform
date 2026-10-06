import { IsUUID, IsEnum } from 'class-validator';
import { BankShareRole } from '@prisma/client';

export class CreateShareDto {
  @IsUUID()
  userId!: string;

  @IsEnum(BankShareRole)
  role!: BankShareRole;
}
