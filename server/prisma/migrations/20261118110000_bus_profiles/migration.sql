ALTER TABLE "Bus" ADD COLUMN "busNumber" TEXT;
ALTER TABLE "Bus" ADD COLUMN "routeName" TEXT;
ALTER TABLE "Bus" ALTER COLUMN "driverName" SET DEFAULT 'Unassigned';
ALTER TABLE "Bus" ALTER COLUMN "phone" SET DEFAULT '';

CREATE UNIQUE INDEX "Bus_busNumber_key" ON "Bus"("busNumber");
