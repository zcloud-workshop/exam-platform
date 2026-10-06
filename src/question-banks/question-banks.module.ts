import { Module } from '@nestjs/common';
import { QuestionBanksController } from './question-banks.controller';
import { QuestionBanksService } from './question-banks.service';
import { BankArchiveService } from './bank-archive.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [QuestionBanksController],
  providers: [QuestionBanksService, BankArchiveService],
})
export class QuestionBanksModule {}
