import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';
import { QuestionImagesService } from './question-images.service';
import { QuestionImageArchiveService } from './question-image-archive.service';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    S3Service,
    QuestionImagesService,
    QuestionImageArchiveService,
  ],
  exports: [QuestionImagesService, QuestionImageArchiveService],
})
export class FilesModule {}
