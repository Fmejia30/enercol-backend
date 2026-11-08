DROP TABLE IF EXISTS "auth_transaction";

-- CreateTable
CREATE TABLE "auth_challenge" (
    "id" TEXT NOT NULL,
    "challenge_id_hash" TEXT NOT NULL,
    "user_id" TEXT,
    "challenge_name" TEXT NOT NULL,
    "encrypted_session" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenge_challenge_id_hash_key" ON "auth_challenge"("challenge_id_hash");

-- CreateIndex
CREATE INDEX "auth_challenge_expires_at_idx" ON "auth_challenge"("expires_at");
