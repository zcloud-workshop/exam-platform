-- CreateTable
CREATE TABLE "user_practice_questions" (
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isWrong" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "favoritedAt" TIMESTAMP(3),

    CONSTRAINT "user_practice_questions_pkey" PRIMARY KEY ("userId","questionId")
);

-- CreateTable
CREATE TABLE "practice_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userAnswer" TEXT NOT NULL,
    "correct" BOOLEAN,
    "answer" TEXT NOT NULL,
    "analysis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_practice_questions_userId_isWrong_lastAttemptAt_idx" ON "user_practice_questions"("userId", "isWrong", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "user_practice_questions_userId_isFavorite_favoritedAt_idx" ON "user_practice_questions"("userId", "isFavorite", "favoritedAt");

-- CreateIndex
CREATE INDEX "user_practice_questions_questionId_idx" ON "user_practice_questions"("questionId");

-- CreateIndex
CREATE INDEX "practice_attempts_userId_createdAt_idx" ON "practice_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "practice_attempts_questionId_idx" ON "practice_attempts"("questionId");

-- AddForeignKey
ALTER TABLE "user_practice_questions" ADD CONSTRAINT "user_practice_questions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_practice_questions" ADD CONSTRAINT "user_practice_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
