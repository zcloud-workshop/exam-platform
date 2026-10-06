import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateRegistrationInviteDto } from './dto/create-registration-invite.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

/**
 * 用户控制器
 * 仅 super_admin 可创建/修改/删除用户, teacher 和 question_admin 可查看用户列表
 */
@ApiTags('用户')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post('registration-invites')
  @Roles(Role.super_admin)
  @ApiOperation({ summary: '生成一次性注册邀请码' })
  createRegistrationInvite(@Body() dto: CreateRegistrationInviteDto) {
    return this.usersService.createRegistrationInvite(dto);
  }

  @Get('registration-invites')
  @Roles(Role.super_admin)
  @ApiOperation({ summary: '获取注册邀请码列表' })
  findRegistrationInvites() {
    return this.usersService.findRegistrationInvites();
  }

  @Post()
  @Roles(Role.super_admin)
  @ApiOperation({ summary: '创建用户' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '获取用户列表' })
  findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id')
  @Roles(Role.super_admin)
  @ApiOperation({ summary: '更新用户' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.super_admin)
  @ApiOperation({ summary: '删除用户' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
