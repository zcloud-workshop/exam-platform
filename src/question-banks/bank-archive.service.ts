import { randomUUID } from 'crypto';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankPermissionService } from '../common/services/bank-permission.service';
import { Role } from '@prisma/client';
import {
  ArchiveCategoryDto,
  ArchiveQuestionDto,
  ArchiveImportMode,
  BankArchiveMetaDto,
  ImportSummaryDto,
} from './dto/bank-archive.dto';
import { BANK_ARCHIVE_VERSION } from './dto/bank-archive.dto';

/**
 * 题库归档服务: 提供整库逻辑导出/导入能力。
 *
 * 设计目标: 实现「按题库独立备份/导出/迁移」—— 不依赖物理 schema 隔离,
 * 输出标准 JSON 归档(含分类树 + 完整题目),跨数据库通用。
 *
 * 归档结构自描述: { meta, categories[], questions[] }, 题目/分类保留原 id 便于精确重建。
 */
@Injectable()
export class BankArchiveService {
  constructor(
    private prisma: PrismaService,
    private bankPermission: BankPermissionService,
  ) {}

  /**
   * 导出整个题库为 JSON 归档。
   * 权限: viewer 及以上(只读操作)。
   */
  async export(
    bankId: string,
    userId: string,
    role: string,
  ): Promise<{
    meta: BankArchiveMetaDto;
    categories: ArchiveCategoryDto[];
    questions: ArchiveQuestionDto[];
  }> {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, bankId, 'viewer');
    }

    const [bank, categories, questions] = await Promise.all([
      this.prisma.questionBank.findUnique({
        where: { id: bankId },
        select: { id: true, name: true, description: true },
      }),
      this.prisma.category.findMany({
        where: { bankId },
        select: { id: true, name: true, parentId: true },
      }),
      this.prisma.question.findMany({
        where: { bankId },
        select: {
          id: true,
          title: true,
          type: true,
          options: true,
          answer: true,
          analysis: true,
          difficulty: true,
          score: true,
          categoryId: true,
          locale: true,
          translations: true,
        },
      }),
    ]);

    if (!bank) throw new NotFoundException('题库不存在');

    return {
      meta: {
        id: bank.id,
        name: bank.name,
        description: bank.description ?? undefined,
        exportedAt: new Date().toISOString(),
        version: BANK_ARCHIVE_VERSION,
      },
      categories,
      questions,
    };
  }

  /**
   * 将归档导入到指定题库。
   * 权限: editor 及以上(写操作)。
   *
   * 冲突策略:
   * - skip:      目标库已存在同名分类 / 同 title+type 题目则跳过(默认)
   * - overwrite: 先清空目标库现有分类和题目(若被试卷引用则拒绝), 再全量导入
   * - merge: 同 skip 语义(保留枚举一致性)
   *
   * id 处理: 生成全新 id 导入(跨库场景源 id 无意义且可能与目标库已有记录冲突),
   * 同时维护 oldId→newId 映射重写 parentId/categoryId, 保证树结构和分类关联正确。
   *
   * 性能: 分类先拓扑排序(父在前)再预生成 UUID, 用 createMany 批量插入;
   *       题目过滤后同样 createMany 批量插入。整个导入在单个事务内完成, 任一失败则回滚。
   */
  async import(
    bankId: string,
    archive: {
      categories: ArchiveCategoryDto[];
      questions: ArchiveQuestionDto[];
    },
    mode: ArchiveImportMode | undefined,
    userId: string,
    role: string,
  ): Promise<ImportSummaryDto> {
    if (role !== Role.super_admin && role !== Role.question_admin) {
      await this.bankPermission.requirePermission(userId, bankId, 'editor');
    }

    const bank = await this.prisma.questionBank.findUnique({
      where: { id: bankId },
    });
    if (!bank) throw new NotFoundException('题库不存在');

    const importMode = mode ?? ArchiveImportMode.skip;
    const summary: ImportSummaryDto = {
      categoriesImported: 0,
      questionsImported: 0,
      skipped: 0,
      errors: [],
    };

    await this.prisma.$transaction(async (tx) => {
      // overwrite 模式: 先清空目标库现有分类和题目, 但若题目被试卷引用则拒绝
      if (importMode === ArchiveImportMode.overwrite) {
        const referencedCount = await tx.paperQuestion.count({
          where: { question: { bankId } },
        });
        if (referencedCount > 0) {
          throw new BadRequestException(
            `目标题库有 ${referencedCount} 道题目被试卷引用, 无法清空; 请改用 skip/merge 模式`,
          );
        }
        const imageCount = await tx.file.count({
          where: { question: { bankId } },
        });
        if (imageCount > 0) {
          throw new BadRequestException(
            '目标题库包含题目图片, 归档不含图片; 请先删除图片再覆盖导入',
          );
        }
        await tx.question.deleteMany({ where: { bankId } });
        await tx.category.deleteMany({ where: { bankId } });
      }

      // skip/merge 模式下用于去重的目标库现有记录签名集合(用 name+bankId 近似判定"已存在等价记录");
      // 因导入生成全新 id, 主键冲突已不可能, skip 语义改为: name 重复的分类 / title+type 重复的题目视为已存在。
      const existingCategoryKeys = new Set(
        (
          await tx.category.findMany({
            where: { bankId },
            select: { name: true },
          })
        ).map((c) => c.name),
      );
      const existingQuestionKeys = new Set(
        (
          await tx.question.findMany({
            where: { bankId },
            select: { title: true, type: true },
          })
        ).map((q) => `${q.title}|${q.type}`),
      );

      // 导入分类: 先拓扑排序(父在前), 再内存过滤 + 预生成 UUID 建映射, 最后 createMany 批量插入。
      // 拓扑排序保证 .map 阶段父分类先写入 categoryIdMap, 子分类查 parentId 时能命中。
      const sortedCategories = topologicalSort(archive.categories);
      const categoryIdMap = new Map<string, string>();
      const categoriesToCreate = sortedCategories
        .filter((cat) => {
          if (
            importMode !== ArchiveImportMode.overwrite &&
            existingCategoryKeys.has(cat.name)
          ) {
            summary.skipped++;
            return false;
          }
          return true;
        })
        .map((cat) => {
          const newId = randomUUID();
          categoryIdMap.set(cat.id, newId);
          return {
            id: newId,
            name: cat.name,
            parentId: cat.parentId
              ? (categoryIdMap.get(cat.parentId) ?? null)
              : null,
            bankId,
          };
        });
      if (categoriesToCreate.length > 0) {
        await tx.category.createMany({ data: categoriesToCreate });
        summary.categoriesImported = categoriesToCreate.length;
      }

      // 导入题目: 内存过滤后预生成 id, createMany 批量插入(categoryId 经映射重写)
      const questionsToCreate = archive.questions
        .filter((q) => {
          if (
            importMode !== ArchiveImportMode.overwrite &&
            existingQuestionKeys.has(`${q.title}|${q.type}`)
          ) {
            summary.skipped++;
            return false;
          }
          return true;
        })
        .map((q) => ({
          id: randomUUID(),
          title: q.title,
          type: q.type,
          options: q.options ?? null,
          answer: q.answer,
          analysis: q.analysis ?? null,
          difficulty: q.difficulty,
          score: q.score,
          categoryId: q.categoryId
            ? (categoryIdMap.get(q.categoryId) ?? null)
            : null,
          locale: q.locale ?? 'zh',
          translations: q.translations ?? null,
          bankId,
        }));
      if (questionsToCreate.length > 0) {
        await tx.question.createMany({ data: questionsToCreate });
        summary.questionsImported = questionsToCreate.length;
      }
    });

    return summary;
  }
}

/**
 * 按分类树层级拓扑排序: 根节点(无 parentId 或 parentId 不在当前集合内)在前,
 * 子节点在后。保证后续遍历时父分类先于子分类被处理。
 *
 * 仅依赖 archive 自身的 id/parentId 关系, 不假设归档导出顺序, 避免隐式耦合。
 */
function topologicalSort(
  categories: ArchiveCategoryDto[],
): ArchiveCategoryDto[] {
  const idSet = new Set(categories.map((c) => c.id));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sorted: ArchiveCategoryDto[] = [];
  const visited = new Set<string>();

  const visit = (cat: ArchiveCategoryDto) => {
    if (visited.has(cat.id)) return;
    visited.add(cat.id);
    // 先递归处理父分类(仅当父分类也在本次导入集合内时)
    if (cat.parentId && idSet.has(cat.parentId)) {
      const parent = byId.get(cat.parentId);
      if (parent) visit(parent);
    }
    sorted.push(cat);
  };

  for (const cat of categories) visit(cat);
  return sorted;
}
