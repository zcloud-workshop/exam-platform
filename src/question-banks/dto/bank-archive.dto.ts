import {
  IsArray,
  IsDefined,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';
import { QuestionImageArchiveDto } from '../../files/dto/question-image-archive.dto';

/**
 * 题库归档格式版本号。未来归档结构演进时递增, 导入时按版本路由解析逻辑。
 */
export const BANK_ARCHIVE_VERSION = 2;

/**
 * 归档导入冲突处理策略:
 * - skip:      目标库已存在同 id 的记录则跳过(默认, 最安全)
 * - overwrite: 先清空目标库现有分类和题目, 再全量导入归档
 * - merge:     目标库已存在同 id 则跳过, 其余插入(语义同 skip, 保留枚举一致性)
 */
export enum ArchiveImportMode {
  skip = 'skip',
  overwrite = 'overwrite',
  merge = 'merge',
}

/** 归档元信息: 描述归档来源, 不参与导入 */
export class BankArchiveMetaDto {
  @IsString() id!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() exportedAt!: string;
  @IsNumber() version!: number;
}

/** 归档中的分类条目: 保留原 id 与 parentId 便于按 id 重建树 */
export class ArchiveCategoryDto {
  @IsString() id!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() parentId?: string | null;
}

/** 归档中的题目条目: 完整字段, options/translations 保持 JSON 字符串(与库内存储一致) */
export class ArchiveQuestionDto {
  @IsString() id!: string;
  @IsString() title!: string;
  @IsEnum(QuestionType) type!: QuestionType;
  @IsOptional() @IsString() options?: string | null;
  @IsString() answer!: string;
  @IsOptional() @IsString() analysis?: string | null;
  @IsNumber() difficulty!: number;
  @IsNumber() score!: number;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsString() locale!: string;
  @IsOptional() @IsString() translations?: string | null;
}

/** 完整归档结构: GET /question-banks/:id/export 的响应体 */
export class BankArchiveDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => BankArchiveMetaDto)
  meta!: BankArchiveMetaDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArchiveCategoryDto)
  categories!: ArchiveCategoryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArchiveQuestionDto)
  questions!: ArchiveQuestionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionImageArchiveDto)
  images?: QuestionImageArchiveDto[];
}

/** POST /question-banks/import 的请求体 */
export class CreateBankArchiveDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => BankArchiveDto)
  archive!: BankArchiveDto;

  @IsOptional()
  @IsString()
  name?: string;
}

/** POST /question-banks/:id/import 的请求体 */
export class ImportBankArchiveDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => BankArchiveDto)
  archive!: BankArchiveDto;

  @IsOptional()
  @IsEnum(ArchiveImportMode)
  mode?: ArchiveImportMode;
}

/** 导入结果摘要 */
export class ImportSummaryDto {
  @IsNumber() categoriesImported!: number;
  @IsNumber() questionsImported!: number;
  @IsOptional() @IsNumber() imagesImported?: number;
  @IsNumber() skipped!: number;
  @IsArray()
  @IsObject({ each: true })
  errors!: { message: string }[];
}
