CREATE TYPE "BusTripPeriod" AS ENUM ('MORNING', 'EVENING');
CREATE TYPE "BusTripStatus" AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED');

ALTER TABLE "Bus" ADD COLUMN "driverUserId" INTEGER;
CREATE UNIQUE INDEX "Bus_driverUserId_key" ON "Bus"("driverUserId");
ALTER TABLE "Bus" ADD CONSTRAINT "Bus_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BusTrip" (
  "id" SERIAL NOT NULL,
  "busId" INTEGER NOT NULL,
  "driverUserId" INTEGER NOT NULL,
  "period" "BusTripPeriod" NOT NULL,
  "status" "BusTripStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "lastPingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  CONSTRAINT "BusTrip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusTrip_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BusTrip_busId_status_startedAt_idx" ON "BusTrip"("busId", "status", "startedAt");
CREATE INDEX "BusTrip_lastPingAt_idx" ON "BusTrip"("lastPingAt");
CREATE UNIQUE INDEX "BusTrip_one_active_trip_per_bus_key" ON "BusTrip"("busId") WHERE "status" = 'ACTIVE';

