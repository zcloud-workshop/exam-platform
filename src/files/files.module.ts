import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';
import { QuestionImagesService } from './question-images.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, S3Service, QuestionImagesService],
  exports: [QuestionImagesService],
})
export class FilesModule {}
