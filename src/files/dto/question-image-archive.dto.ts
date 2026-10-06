import {
  IsBase64,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class QuestionImageArchiveDto {
  @IsString() questionId!: string;
  @IsString() originalName!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) @Max(10 * 1024 * 1024) size!: number;
  @IsOptional() @IsString() optionKey?: string | null;
  @IsBase64() data!: string;
}
