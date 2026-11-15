-- CreateTable
CREATE TABLE "technical_dataset" (
    "id" TEXT NOT NULL,
    "post_sale_request_id" TEXT NOT NULL,
    "demand_threshold" DECIMAL(12,3) NOT NULL,
    "demand_unit" TEXT NOT NULL,
    "consumption_unit" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,

    CONSTRAINT "technical_dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_reading" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "measured_demand" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "telemetry_reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_consumption" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "consumption" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "historical_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "technical_dataset_post_sale_request_id_key" ON "technical_dataset"("post_sale_request_id");

-- CreateIndex
CREATE INDEX "telemetry_reading_dataset_id_measured_at_idx" ON "telemetry_reading"("dataset_id", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_reading_dataset_id_measured_at_key" ON "telemetry_reading"("dataset_id", "measured_at");

-- CreateIndex
CREATE INDEX "historical_consumption_dataset_id_period_start_idx" ON "historical_consumption"("dataset_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "historical_consumption_dataset_id_period_start_key" ON "historical_consumption"("dataset_id", "period_start");

-- AddForeignKey
ALTER TABLE "technical_dataset" ADD CONSTRAINT "technical_dataset_post_sale_request_id_fkey" FOREIGN KEY ("post_sale_request_id") REFERENCES "post_sale_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_reading" ADD CONSTRAINT "telemetry_reading_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "technical_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_consumption" ADD CONSTRAINT "historical_consumption_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "technical_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
