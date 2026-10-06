import { Module } from '@nestjs/common';
import { PracticeController } from './practice.controller';
import { PracticeService } from './practice.service';
import { FilesModule } from '../files/files.module';
import { PersonalPracticeController } from './personal-practice.controller';

@Module({
  imports: [FilesModule],
  controllers: [PracticeController, PersonalPracticeController],
  providers: [PracticeService],
})
export class PracticeModule {}
