-- AlterTable
CREATE UNIQUE INDEX "technical_analysis_id_post_sale_request_id_key" ON "technical_analysis"("id", "post_sale_request_id");

-- CreateEnum
CREATE TYPE "technical_report_status" AS ENUM ('DRAFT');

-- CreateTable
CREATE TABLE "technical_report" (
    "id" TEXT NOT NULL,
    "post_sale_request_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "technical_report_status" NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "reasoning_effort" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_by_sub" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technical_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_report_post_sale_request_id_created_at_idx" ON "technical_report"("post_sale_request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "technical_report_post_sale_request_id_version_key" ON "technical_report"("post_sale_request_id", "version");

-- AddForeignKey
ALTER TABLE "technical_report" ADD CONSTRAINT "technical_report_post_sale_request_id_fkey" FOREIGN KEY ("post_sale_request_id") REFERENCES "post_sale_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_report" ADD CONSTRAINT "technical_report_analysis_id_post_sale_request_id_fkey" FOREIGN KEY ("analysis_id", "post_sale_request_id") REFERENCES "technical_analysis"("id", "post_sale_request_id") ON DELETE CASCADE ON UPDATE CASCADE;
