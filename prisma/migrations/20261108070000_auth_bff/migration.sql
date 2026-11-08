-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "session_id_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT,
    "encrypted_access_token" TEXT NOT NULL,
    "encrypted_refresh_token" TEXT NOT NULL,
    "encrypted_csrf_token" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "csrf_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_transaction" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "encrypted_code_verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_session_id_hash_key" ON "auth_session"("session_id_hash");

-- CreateIndex
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_transaction_state_hash_key" ON "auth_transaction"("state_hash");

-- CreateIndex
CREATE INDEX "auth_transaction_expires_at_idx" ON "auth_transaction"("expires_at");
