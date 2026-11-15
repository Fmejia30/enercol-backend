-- CreateEnum
CREATE TYPE "post_sale_request_status" AS ENUM ('ABIERTA', 'EN_ANALISIS', 'INFORME_EMITIDO');

-- CreateEnum
CREATE TYPE "post_sale_request_type" AS ENUM ('VERIFICACION_DEMANDA', 'DESVIACION_FACTOR_POTENCIA', 'CONSUMO_ATIPICO', 'CALIDAD_DE_POTENCIA');

-- CreateTable
CREATE TABLE "post_sale_request" (
    "id" TEXT NOT NULL,
    "ticket_code" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "facility_name" TEXT NOT NULL,
    "asset_id" TEXT,
    "assigned_specialist_sub" TEXT NOT NULL,
    "type" "post_sale_request_type" NOT NULL,
    "description" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "post_sale_request_status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_sale_request_ticket_code_key" ON "post_sale_request"("ticket_code");

-- CreateIndex
CREATE INDEX "post_sale_request_assigned_specialist_sub_created_at_idx" ON "post_sale_request"("assigned_specialist_sub", "created_at");

-- CreateIndex
CREATE INDEX "post_sale_request_status_created_at_idx" ON "post_sale_request"("status", "created_at");
