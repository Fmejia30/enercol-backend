ALTER TYPE "technical_report_status" ADD VALUE 'PENDING_VALIDATION';
ALTER TYPE "technical_report_status" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "technical_report_status" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "technical_report_status" ADD VALUE 'REANALYSIS_REQUIRED';
ALTER TYPE "technical_report_status" ADD VALUE 'APPROVED';

CREATE TYPE "technical_report_review_event" AS ENUM ('SUBMITTED', 'REVIEW_STARTED', 'APPROVED', 'CHANGES_REQUESTED', 'REANALYSIS_REQUIRED');

CREATE TYPE "technical_report_review_slot" AS ENUM ('SUBMITTED', 'STARTED', 'DECISION');

CREATE TABLE "technical_report_review" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "post_sale_request_id" TEXT NOT NULL,
    "submitted_version" INTEGER NOT NULL,
    "event_type" "technical_report_review_event" NOT NULL,
    "slot" "technical_report_review_slot" NOT NULL,
    "actor_sub" TEXT NOT NULL,
    "comments" TEXT,
    "analysis_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technical_report_review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technical_report_review_report_id_slot_key" ON "technical_report_review"("report_id", "slot");

CREATE INDEX "technical_report_review_post_sale_request_id_created_at_idx" ON "technical_report_review"("post_sale_request_id", "created_at");

CREATE INDEX "technical_report_status_updated_at_idx" ON "technical_report"("status", "updated_at");

ALTER TABLE "technical_report_review" ADD CONSTRAINT "technical_report_review_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "technical_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
