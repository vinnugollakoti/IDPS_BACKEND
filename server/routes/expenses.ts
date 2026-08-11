import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { uploadExpenseBill } from "../lib/supabaseStorage";
import { logAudit } from "../utils/audit";

const router = express.Router();
const categories = ["STATIONERY", "EVENTS", "SPORTS_EQUIPMENT", "CLASS_MISCELLANEOUS", "COMPUTER_EQUIPMENT", "UTILITY", "FURNITURE", "OTHER"];
const onlineAccounts = ["SANKALP", "NARESH_SIR"];

router.use(auth, (req: AuthRequest, res: Response, next) => {
  if (!isExecutiveRole(req.user?.role)) return res.status(403).json({ message: "Spending Manager is restricted to Director and Chairman accounts." });
  next();
});

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category = typeof req.query.category === "string" && categories.includes(req.query.category) ? req.query.category : undefined;
    const paymentMode = req.query.paymentMode === "CASH" || req.query.paymentMode === "ONLINE" ? req.query.paymentMode : undefined;
    const from = typeof req.query.from === "string" && !Number.isNaN(Date.parse(req.query.from)) ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" && !Number.isNaN(Date.parse(req.query.to)) ? new Date(req.query.to) : undefined;
    const expenses = await prisma.expense.findMany({
      where: {
        ...(category ? { category: category as any } : {}),
        ...(paymentMode ? { paymentMode: paymentMode as any } : {}),
        ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { notes: { contains: search, mode: "insensitive" } }] } : {}),
        ...(from || to ? { transactionDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });
    return res.json({ message: "Expenses fetched successfully", data: expenses.map((expense) => ({ ...expense, amount: expense.amount.toString() })) });
  } catch (err: any) {
    console.error("GET /expenses error:", err);
    return res.status(500).json({ message: err?.message || "Unable to fetch expenses" });
  }
});

router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const { title, category, amount, transactionDate, paymentMode, onlineAccount, notes, billBase64, billMimeType } = req.body ?? {};
    if (!title?.trim() || !categories.includes(category) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !transactionDate || Number.isNaN(Date.parse(transactionDate))) {
      return res.status(400).json({ message: "Title, category, positive amount, and transaction date are required." });
    }
    if (!["CASH", "ONLINE"].includes(paymentMode)) return res.status(400).json({ message: "Payment mode must be Cash or Online." });
    if (paymentMode === "ONLINE" && !onlineAccounts.includes(onlineAccount)) return res.status(400).json({ message: "Choose the online account used for this payment." });

    let bill: { billUrl: string; billPath: string; billMimeType: string } | undefined;
    if (billBase64) bill = await uploadExpenseBill({ imageBase64: billBase64, imageMimeType: billMimeType, path: `expenses/${req.user.userId ?? req.user.id}_${Date.now()}` });
    const expense = await prisma.expense.create({
      data: {
        title: title.trim(), category, amount: Number(amount), transactionDate: new Date(transactionDate), paymentMode,
        onlineAccount: paymentMode === "ONLINE" ? onlineAccount : null,
        notes: notes?.trim() || null, ...(bill ?? {}), createdById: Number(req.user.userId ?? req.user.id),
      },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });
    void logAudit({ req, action: "CREATE_EXPENSE", tag: "FINANCE" as any, details: `Recorded expense "${title.trim()}" for ₹${amount}`, entityType: "Expense", entityId: expense.id });
    return res.status(201).json({ message: "Expense recorded successfully", data: { ...expense, amount: expense.amount.toString() } });
  } catch (err: any) {
    console.error("POST /expenses error:", err);
    return res.status(500).json({ message: err?.message || "Unable to record expense" });
  }
});

router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: Number(req.params.id) }, include: { createdBy: { select: { id: true, name: true, role: true } } } });
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    return res.json({ message: "Expense fetched successfully", data: { ...expense, amount: expense.amount.toString() } });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Unable to fetch expense" });
  }
});

export default router;
