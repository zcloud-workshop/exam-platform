import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateRegistrationInviteDto {
  @ApiProperty({ description: '注册账号角色', enum: Role })
  @IsEnum(Role)
  role!: Role;
}
