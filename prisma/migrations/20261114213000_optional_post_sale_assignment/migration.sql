-- AlterTable
ALTER TABLE "post_sale_request" ALTER COLUMN "assigned_specialist_sub" DROP NOT NULL;

-- CreateTable
CREATE TABLE "post_sale_request_ticket" (
    "id" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_sale_request_ticket_pkey" PRIMARY KEY ("id")
);

-- The counter is not a business request. It starts at zero so the first ticket is PV-000001.
INSERT INTO "post_sale_request_ticket" ("id", "last_value") VALUES ('post-sale', 0);
