import { ApiProperty } from '@nestjs/swagger';

export class ImportError {
  @ApiProperty({ description: '行号' })
  row!: number;

  @ApiProperty({ description: '错误信息' })
  message!: string;
}

export class ImportResultDto {
  @ApiProperty({ description: '导入图片数', required: false })
  imagesImported?: number;

  @ApiProperty({ description: '总行数' })
  total!: number;

  @ApiProperty({ description: '成功数' })
  success!: number;

  @ApiProperty({ description: '失败数' })
  failed!: number;

  @ApiProperty({ description: '错误明细', type: [ImportError] })
  errors!: ImportError[];
}
