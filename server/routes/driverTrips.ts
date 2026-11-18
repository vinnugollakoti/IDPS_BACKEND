import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
import { isExecutiveRole } from "../middleware/auth";
import webpush, { PushSubscription } from "web-push";
import { isBusTripWindowOpen } from "../utils/busTripSchedule";

const router = express.Router();
router.use(auth);
const userId = (req: AuthRequest) => Number(req.user?.userId ?? req.user?.id);
const validPoint = (body: any) => Number.isFinite(body?.latitude) && body.latitude >= -90 && body.latitude <= 90 && Number.isFinite(body?.longitude) && body.longitude >= -180 && body.longitude <= 180;
const metric = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
const gpsMetadata = (body: any) => ({ accuracy: metric(body?.accuracy, 0, 10_000), heading: metric(body?.heading, 0, 360), speed: metric(body?.speed, 0, 100) });
async function assignedBus(req: AuthRequest) {
  if (req.user?.role !== "TEACHER") return null;
  return prisma.bus.findFirst({ where: { driverUserId: userId(req) } });
}

router.put("/admin/buses/:busId/assignment", async (req: AuthRequest, res: Response) => {
  try {
    if (!isExecutiveRole(req.user?.role)) return res.status(403).json({ message: "Only school leadership can assign bus drivers" });
    const busId = Number(req.params.busId);
    if (!Number.isSafeInteger(busId) || busId < 1 || req.body?.email !== null && typeof req.body?.email !== "string") return res.status(400).json({ message: "Provide a valid bus id and driver email, or email null to unassign" });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus) return res.status(404).json({ message: "Bus not found" });
    const activeTrip = await prisma.busTrip.findFirst({ where: { busId, status: "ACTIVE" }, select: { id: true, period: true, lastPingAt: true } });
    if (activeTrip && (!isBusTripWindowOpen(activeTrip.period) || Date.now() - activeTrip.lastPingAt.getTime() > 90_000)) {
      await prisma.busTrip.updateMany({ where: { id: activeTrip.id, status: "ACTIVE" }, data: { status: "EXPIRED", endedAt: new Date() } });
    } else if (activeTrip) return res.status(409).json({ message: "End the active bus trip before changing its driver" });
    const user = email ? await prisma.user.findUnique({ where: { email }, include: { teacher: true } }) : null;
    if (email && (!user || user.role !== "TEACHER" || !user.teacher)) return res.status(400).json({ message: "Driver must have an active teacher account" });
    const assigned = await prisma.bus.update({ where: { id: busId }, data: { driverUserId: user?.id ?? null, ...(user ? { driverName: user.name } : {}) }, select: { id: true, driverName: true, driverUserId: true } });
    return res.json({ bus: assigned });
  } catch (error: any) { console.error("PUT bus driver assignment", error); return res.status(error?.code === "P2002" ? 409 : 500).json({ message: error?.code === "P2002" ? "This driver is already assigned to another bus" : "Could not assign bus driver" }); }
});

router.get("/assignment", async (req: AuthRequest, res: Response) => {
  try {
    const bus = await assignedBus(req);
    if (!bus) return res.status(404).json({ message: "No bus is assigned to this driver account" });
    let activeTrip = await prisma.busTrip.findFirst({ where: { busId: bus.id, status: "ACTIVE" }, orderBy: { startedAt: "desc" } });
    if (activeTrip && (!isBusTripWindowOpen(activeTrip.period) || Date.now() - activeTrip.lastPingAt.getTime() > 90_000)) {
      await prisma.busTrip.updateMany({ where: { id: activeTrip.id, status: "ACTIVE" }, data: { status: "EXPIRED", endedAt: new Date() } });
      activeTrip = null;
    }
    return res.json({ bus: { id: bus.id, driverName: bus.driverName, route: bus.route }, activeTrip });
  } catch (error) { console.error("GET driver assignment", error); return res.status(500).json({ message: "Could not load driver assignment" }); }
});

router.post("/trips/start", async (req: AuthRequest, res: Response) => {
  try {
    const bus = await assignedBus(req);
    if (!bus) return res.status(403).json({ message: "This driver account has no assigned bus" });
    const period = req.body?.period;
    if (!["MORNING", "EVENING"].includes(period) || !validPoint(req.body)) return res.status(400).json({ message: "Select a trip period and provide a valid starting location" });
    if (!isBusTripWindowOpen(period)) return res.status(403).json({ message: "Trips can only start during school transport hours" });
    await prisma.busTrip.updateMany({ where: { busId: bus.id, status: "ACTIVE", OR: [{ lastPingAt: { lt: new Date(Date.now() - 90_000) } }, { period: "MORNING", startedAt: { lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } }, { period: "EVENING", startedAt: { lt: new Date(Date.now() - 8 * 60 * 60 * 1000) } }] }, data: { status: "EXPIRED", endedAt: new Date() } });
    if (await prisma.busTrip.findFirst({ where: { busId: bus.id, status: "ACTIVE" } })) return res.status(409).json({ message: "This bus already has an active trip" });
    const trip = await prisma.busTrip.create({ data: { busId: bus.id, driverUserId: userId(req), period, status: "ACTIVE", latitude: req.body.latitude, longitude: req.body.longitude, ...gpsMetadata(req.body) } });
    const parents = await prisma.parentStudent.findMany({ where: { student: { busId: bus.id } }, include: { parent: { select: { userId: true } } } });
    const ids = [...new Set(parents.map(item => item.parent.userId).filter((id): id is number => Boolean(id)))];
    const tokens = await prisma.pushToken.findMany({ where: { userId: { in: ids } }, select: { token: true, platform: true } });
    const mobile = tokens.filter(item => item.platform !== "web");
    const title = "School bus is on the way";
    const body = period === "MORNING" ? "Your child's bus has started its morning route." : "Your child's bus has started from school.";
    for (let offset = 0; offset < mobile.length; offset += 100) {
      const messages = mobile.slice(offset, offset + 100).map(item => ({ to: item.token, sound: "default", title, body, channelId: "default", priority: "high", data: { type: "BUS_TRIP_STARTED", tripId: trip.id } }));
      void fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(messages) }).catch(error => console.warn("Bus trip notification failed", error));
    }
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY; const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    const webTargets = tokens.filter(item => item.platform === "web");
    if (publicKey && privateKey && webTargets.length) {
      webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT ?? "mailto:chairman@idps.com", publicKey, privateKey);
      const payload = JSON.stringify({ title, body, url: "/" });
      for (const target of webTargets) void (async () => { try { await webpush.sendNotification(JSON.parse(target.token) as PushSubscription, payload, { TTL: 86400 }); } catch (error: any) { console.warn("Bus trip web push failed", error?.message); } })();
    }
    return res.status(201).json({ trip });
  } catch (error: any) { console.error("POST driver trip start", error); return res.status(error?.code === "P2002" ? 409 : 500).json({ message: error?.code === "P2002" ? "This bus already has an active trip" : "Could not start bus trip" }); }
});

router.post("/trips/:tripId/location", async (req: AuthRequest, res: Response) => {
  try {
    const bus = await assignedBus(req); const id = Number(req.params.tripId);
    if (!bus) return res.status(403).json({ message: "This driver account has no assigned bus" });
    if (!validPoint(req.body)) return res.status(400).json({ message: "Provide a valid GPS location" });
    const trip = await prisma.busTrip.findFirst({ where: { id, busId: bus.id, driverUserId: userId(req), status: "ACTIVE" } });
    if (!trip) return res.status(404).json({ message: "Active trip not found" });
    if (!isBusTripWindowOpen(trip.period)) {
      await prisma.busTrip.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "EXPIRED", endedAt: new Date() } });
      return res.status(410).json({ message: "The transport window ended. Location sharing has stopped." });
    }
    if (Date.now() - trip.lastPingAt.getTime() < 4_500) return res.status(429).json({ message: "Location updates must be at least five seconds apart" });
    const location = { latitude: req.body.latitude, longitude: req.body.longitude, ...gpsMetadata(req.body), recordedAt: new Date() };
    await prisma.busTrip.update({ where: { id }, data: { lastPingAt: location.recordedAt, latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, heading: location.heading, speed: location.speed } });
    return res.json({ location });
  } catch (error) { console.error("POST driver location", error); return res.status(500).json({ message: "Could not update bus location" }); }
});

router.post("/trips/:tripId/end", async (req: AuthRequest, res: Response) => {
  try {
    const bus = await assignedBus(req); const id = Number(req.params.tripId);
    if (!bus) return res.status(403).json({ message: "This driver account has no assigned bus" });
    const result = await prisma.busTrip.updateMany({ where: { id, busId: bus.id, driverUserId: userId(req), status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
    return result.count ? res.json({ message: "Trip ended and location sharing stopped" }) : res.status(404).json({ message: "Active trip not found" });
  } catch (error) { console.error("POST end driver trip", error); return res.status(500).json({ message: "Could not end trip" }); }
});
export default router;
