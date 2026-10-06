CREATE TABLE "registration_invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "registration_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_invites_code_key" ON "registration_invites"("code");
