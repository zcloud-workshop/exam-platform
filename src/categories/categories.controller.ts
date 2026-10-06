import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('分类')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Post()
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '创建分类' })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.categoriesService.create(dto, userId, role);
  }

  @Get()
  @ApiOperation({ summary: '获取分类列表' })
  @ApiQuery({ name: 'bankId', required: true, description: '题库ID' })
  findAll(
    @Query('bankId') bankId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.categoriesService.findAll(bankId, userId, role);
  }

  @Get('tree')
  @ApiOperation({ summary: '获取分类树' })
  @ApiQuery({ name: 'bankId', required: true, description: '题库ID' })
  getTree(
    @Query('bankId') bankId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.categoriesService.getTree(bankId, userId, role);
  }

  @Patch(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '更新分类' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.categoriesService.update(id, dto, userId, role);
  }

  @Delete(':id')
  @Roles(Role.super_admin, Role.question_admin, Role.teacher)
  @ApiOperation({ summary: '删除分类' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.categoriesService.remove(id, userId, role);
  }
}
