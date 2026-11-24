CREATE TABLE "BillDeskWebhookEvent" (
  "eventKey" TEXT PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "authStatus" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL CHECK ("amount" > 0),
  "currency" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BillDeskWebhookEvent_merchantId_orderId_idx"
  ON "BillDeskWebhookEvent" ("merchantId", "orderId");
-- Only the backend database role should access gateway events.
ALTER TABLE "BillDeskWebhookEvent" ENABLE ROW LEVEL SECURITY;
