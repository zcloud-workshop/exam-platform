-- AlterTable
ALTER TABLE "files" ADD COLUMN     "questionId" TEXT;

-- CreateIndex
CREATE INDEX "files_questionId_idx" ON "files"("questionId");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
