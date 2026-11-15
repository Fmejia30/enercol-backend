-- AlterTable
ALTER TABLE "technical_dataset" ALTER COLUMN "demand_threshold" DROP NOT NULL;

-- AlterTable
ALTER TABLE "technical_dataset" ADD COLUMN "evaluation_consumption" DECIMAL(14,3);
