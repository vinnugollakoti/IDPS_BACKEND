import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { serverCache } from "../utils/cache";

const router = express.Router();
router.use(auth);
const canManage = (req: AuthRequest) => isExecutiveRole(req.user?.role) || req.user?.role === "RECEPTIONIST";

function parseRoute(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 40 || value.some(item => typeof item !== "string")) return null;
  return value.map(item => item.trim()).filter(Boolean);
}

router.post("/", async (req: AuthRequest, res: Response) => {
  if (!canManage(req)) return res.status(403).json({ message: "You are not allowed to manage buses" });
  const busNumber = typeof req.body?.busNumber === "string" ? req.body.busNumber.trim() : "";
  const routeName = typeof req.body?.routeName === "string" ? req.body.routeName.trim() : "";
  const route = parseRoute(req.body?.route);
  if (!busNumber || !routeName || route === null) return res.status(400).json({ message: "Bus number, route name, and a valid list of route stops are required" });
  try {
    const bus = await prisma.bus.create({ data: { busNumber, routeName, route, driverName: "Unassigned", phone: "" } });
    void serverCache.clear();
    return res.status(201).json({ message: "Bus created successfully", data: bus });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ message: "A bus with this number already exists" });
    console.error("POST /bus", error);
    return res.status(500).json({ message: "Could not create bus" });
  }
});

router.put("/:id", async (req: AuthRequest, res: Response) => {
  if (!canManage(req)) return res.status(403).json({ message: "You are not allowed to manage buses" });
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid bus id" });
  if (await prisma.busTrip.findFirst({ where: { busId: id, status: "ACTIVE" }, select: { id: true } })) return res.status(409).json({ message: "End the active trip before editing this bus" });
  const data: { busNumber?: string; routeName?: string; route?: string[] } = {};
  if (req.body?.busNumber !== undefined) {
    if (typeof req.body.busNumber !== "string" || !req.body.busNumber.trim()) return res.status(400).json({ message: "Bus number is required" });
    data.busNumber = req.body.busNumber.trim();
  }
  if (req.body?.routeName !== undefined) {
    if (typeof req.body.routeName !== "string" || !req.body.routeName.trim()) return res.status(400).json({ message: "Route name is required" });
    data.routeName = req.body.routeName.trim();
  }
  if (req.body?.route !== undefined) {
    const route = parseRoute(req.body.route);
    if (route === null) return res.status(400).json({ message: "Route stops must be a list of text values" });
    data.route = route;
  }
  if (!Object.keys(data).length) return res.status(400).json({ message: "No bus details were provided" });
  try {
    const bus = await prisma.bus.update({ where: { id }, data, include: { driverUser: { select: { id: true, name: true, email: true, driver: { select: { phone: true } } } }, _count: { select: { students: true } } } });
    void serverCache.clear();
    return res.json({ message: "Bus updated successfully", data: bus });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ message: "A bus with this number already exists" });
    if (error?.code === "P2025") return res.status(404).json({ message: "Bus not found" });
    console.error("PUT /bus/:id", error);
    return res.status(500).json({ message: "Could not update bus" });
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response) => {
  if (!canManage(req)) return res.status(403).json({ message: "You are not allowed to manage buses" });
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid bus id" });
  try {
    const bus = await prisma.bus.findUnique({ where: { id }, include: { _count: { select: { students: true } } } });
    if (!bus) return res.status(404).json({ message: "Bus not found" });
    if (bus._count.students) return res.status(409).json({ message: "Move students to another bus before deleting this bus" });
    if (await prisma.busTrip.findFirst({ where: { busId: id, status: "ACTIVE" }, select: { id: true } })) return res.status(409).json({ message: "End the active trip before deleting this bus" });
    await prisma.bus.delete({ where: { id } });
    void serverCache.clear();
    return res.json({ message: "Bus deleted successfully" });
  } catch (error) {
    console.error("DELETE /bus/:id", error);
    return res.status(500).json({ message: "Could not delete bus" });
  }
});

export default router;
