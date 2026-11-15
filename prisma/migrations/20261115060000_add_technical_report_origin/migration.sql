CREATE TYPE "technical_report_origin" AS ENUM ('AI', 'MANUAL');

ALTER TABLE "technical_report"
ADD COLUMN "origin" "technical_report_origin" NOT NULL DEFAULT 'AI';
