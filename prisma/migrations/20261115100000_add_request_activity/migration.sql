ALTER TYPE "post_sale_request_status" ADD VALUE 'RECEIVED';
ALTER TYPE "post_sale_request_status" ADD VALUE 'ASSIGNED';
ALTER TYPE "post_sale_request_status" ADD VALUE 'IN_ANALYSIS';
ALTER TYPE "post_sale_request_status" ADD VALUE 'REPORT_DRAFT';
ALTER TYPE "post_sale_request_status" ADD VALUE 'PENDING_VALIDATION';
ALTER TYPE "post_sale_request_status" ADD VALUE 'REPORT_APPROVED';
ALTER TYPE "post_sale_request_status" ADD VALUE 'REPORT_CHANGES_REQUESTED';
ALTER TYPE "post_sale_request_status" ADD VALUE 'REANALYSIS_REQUIRED';

CREATE TYPE "post_sale_request_activity_event" AS ENUM (
  'REQUEST_REGISTERED',
  'SPECIALIST_ASSIGNED',
  'ANALYSIS_COMPLETED',
  'ANALYSIS_FAILED',
  'REPORT_GENERATED',
  'REPORT_SUBMITTED',
  'REVIEW_STARTED',
  'REPORT_APPROVED',
  'CHANGES_REQUESTED',
  'REPORT_REVISED',
  'REANALYSIS_REQUIRED'
);

CREATE TABLE "post_sale_request_activity" (
    "id" TEXT NOT NULL,
    "post_sale_request_id" TEXT NOT NULL,
    "event_type" "post_sale_request_activity_event" NOT NULL,
    "previous_status" "post_sale_request_status",
    "new_status" "post_sale_request_status",
    "description" TEXT NOT NULL,
    "actor_sub" TEXT,
    "actor_role" TEXT,
    "technical_analysis_id" TEXT,
    "technical_report_id" TEXT,
    "report_version" INTEGER,
    "metadata" JSONB,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_request_activity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "post_sale_request_activity_dedupe_key_key" ON "post_sale_request_activity"("dedupe_key");

CREATE INDEX "post_sale_request_activity_post_sale_request_id_created_at_idx" ON "post_sale_request_activity"("post_sale_request_id", "created_at");

ALTER TABLE "post_sale_request_activity" ADD CONSTRAINT "post_sale_request_activity_post_sale_request_id_fkey" FOREIGN KEY ("post_sale_request_id") REFERENCES "post_sale_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_sale_request_activity" ADD CONSTRAINT "post_sale_request_activity_technical_analysis_id_fkey" FOREIGN KEY ("technical_analysis_id") REFERENCES "technical_analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "post_sale_request_activity" ADD CONSTRAINT "post_sale_request_activity_technical_report_id_fkey" FOREIGN KEY ("technical_report_id") REFERENCES "technical_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
