-- CreateEnum
CREATE TYPE "technical_analysis_status" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "technical_analysis" (
    "id" TEXT NOT NULL,
    "post_sale_request_id" TEXT NOT NULL,
    "status" "technical_analysis_status" NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "executed_by_sub" TEXT NOT NULL,
    "failure_message" TEXT,
    "input_snapshot" JSONB NOT NULL,
    "findings" JSONB NOT NULL,

    CONSTRAINT "technical_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_analysis_post_sale_request_id_executed_at_idx" ON "technical_analysis"("post_sale_request_id", "executed_at");

-- AddForeignKey
ALTER TABLE "technical_analysis" ADD CONSTRAINT "technical_analysis_post_sale_request_id_fkey" FOREIGN KEY ("post_sale_request_id") REFERENCES "post_sale_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
