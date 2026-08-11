CREATE TYPE "ExpenseCategory" AS ENUM ('STATIONERY', 'EVENTS', 'SPORTS_EQUIPMENT', 'CLASS_MISCELLANEOUS', 'COMPUTER_EQUIPMENT', 'UTILITY', 'FURNITURE', 'OTHER');
CREATE TYPE "ExpensePaymentMode" AS ENUM ('CASH', 'ONLINE');
CREATE TYPE "ExpenseOnlineAccount" AS ENUM ('SANKALP', 'NARESH_SIR');

CREATE TABLE "Expense" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "category" "ExpenseCategory" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transactionDate" DATE NOT NULL,
  "paymentMode" "ExpensePaymentMode" NOT NULL,
  "onlineAccount" "ExpenseOnlineAccount",
  "notes" TEXT,
  "billUrl" TEXT,
  "billPath" TEXT,
  "billMimeType" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Expense_category_idx" ON "Expense"("category");
CREATE INDEX "Expense_transactionDate_idx" ON "Expense"("transactionDate");
CREATE INDEX "Expense_paymentMode_idx" ON "Expense"("paymentMode");
CREATE INDEX "Expense_createdById_idx" ON "Expense"("createdById");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
