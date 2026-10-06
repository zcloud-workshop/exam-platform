import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { Role, Category } from '@prisma/client';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

type CategoryWithCount = Category & { _count: { questions: number } };
type CategoryTreeNode = CategoryWithCount & { children: CategoryTreeNode[] };

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
  ) {}

  async create(dto: CreateCategoryDto, userId: string, role: string) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, dto.bankId, 'editor');
    }
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new BadRequestException('父分类不存在');
      if (parent.bankId !== dto.bankId) {
        throw new BadRequestException('父分类与当前题库不一致');
      }
    }
    return this.prisma.category.create({ data: dto });
  }

  async findAll(bankId: string, userId: string, role: string) {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, bankId, 'viewer');
    }
    return this.prisma.category.findMany({
      where: { bankId },
      include: { children: true, _count: { select: { questions: true } } },
    });
  }

  async getTree(
    bankId: string,
    userId: string,
    role: string,
  ): Promise<CategoryTreeNode[]> {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, bankId, 'viewer');
    }
    const categories = await this.prisma.category.findMany({
      where: { bankId },
      include: { _count: { select: { questions: true } } },
    });

    const map = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    for (const cat of categories) {
      map.set(cat.id, { ...cat, children: [] });
    }

    for (const cat of categories) {
      const node = map.get(cat.id)!;
      if (cat.parentId && map.has(cat.parentId)) {
        map.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async findOne(id: string, userId: string, role: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
        _count: { select: { questions: true } },
      },
    });
    if (!category) throw new NotFoundException('分类不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        category.bankId,
        'viewer',
      );
    }
    return category;
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    userId: string,
    role: string,
  ) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { bankId: true },
    });
    if (!category) throw new NotFoundException('分类不存在');
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(
        userId,
        category.bankId,
        'editor',
      );
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string, role: string) {
    const category = await this.findOne(id, userId, role);
    if (category.children.length > 0) {
      throw new BadRequestException('该分类下有子分类, 无法删除');
    }
    if (category._count.questions > 0) {
      throw new BadRequestException('该分类下有题目, 无法删除');
    }
    return this.prisma.category.delete({ where: { id } });
  }
}
