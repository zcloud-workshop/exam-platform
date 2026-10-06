import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: 'teacher1' })
  @IsNotEmpty()
  @IsString()
  username!: string;

  @ApiProperty({ description: '密码', minLength: 6, example: '123456' })
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({
    description: '角色',
    enum: Role,
    default: Role.student,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
