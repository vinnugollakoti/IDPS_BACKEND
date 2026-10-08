-- CreateTable
CREATE TABLE "ExpenseReserve" (
    "id" SERIAL NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "givenBy" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "notes" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseReserve_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseReserve_transactionDate_idx" ON "ExpenseReserve"("transactionDate");

-- CreateIndex
CREATE INDEX "ExpenseReserve_createdById_idx" ON "ExpenseReserve"("createdById");

-- AddForeignKey
ALTER TABLE "ExpenseReserve" ADD CONSTRAINT "ExpenseReserve_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
