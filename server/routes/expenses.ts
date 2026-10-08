import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { uploadExpenseBill } from "../lib/supabaseStorage";
import { logAudit } from "../utils/audit";

const router = express.Router();
const categories = ["STATIONERY", "EVENTS", "SPORTS_EQUIPMENT", "CLASS_MISCELLANEOUS", "COMPUTER_EQUIPMENT", "UTILITY", "FURNITURE", "OTHER"];
const onlineAccounts = ["SANKALP", "NARESH_SIR"];

router.use(auth, async (req: AuthRequest, res: Response, next) => {
  let isAllowed = isExecutiveRole(req.user?.role) || req.user?.role === "RECEPTIONIST";
  if (!isAllowed && (req.user?.userId || req.user?.id)) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: Number(req.user.userId || req.user.id) },
        select: { role: true },
      });
      if (dbUser && (isExecutiveRole(dbUser.role) || dbUser.role === "RECEPTIONIST")) {
        req.user.role = dbUser.role;
        isAllowed = true;
      }
    } catch {}
  }
  if (!isAllowed) return res.status(403).json({ message: "Spending Manager is restricted to authorized administrative accounts." });
  next();
});

async function calculateReserveSummary() {
  const [reserves, cashExpenses] = await Promise.all([
    prisma.expenseReserve.findMany({ select: { amount: true } }),
    prisma.expense.findMany({ where: { paymentMode: "CASH" }, select: { amount: true } }),
  ]);
  const totalReserveAdded = reserves.reduce((sum, r) => sum + Number(r.amount), 0);
  const totalCashSpent = cashExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const currentReserveBalance = totalReserveAdded - totalCashSpent;
  return {
    totalReserveAdded,
    totalCashSpent,
    currentReserveBalance,
  };
}

// ─── Cash Reserve Endpoints ───────────────────────────────────────────────────

router.get("/reserves", async (req: AuthRequest, res: Response) => {
  try {
    const [reserves, summary] = await Promise.all([
      prisma.expenseReserve.findMany({
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        include: { createdBy: { select: { id: true, name: true, role: true } } },
      }),
      calculateReserveSummary(),
    ]);
    return res.json({
      message: "Reserves fetched successfully",
      data: reserves.map((r) => ({ ...r, amount: r.amount.toString() })),
      summary,
    });
  } catch (err: any) {
    console.error("GET /expenses/reserves error:", err);
    return res.status(500).json({ message: err?.message || "Unable to fetch reserves" });
  }
});

router.post("/reserves", async (req: AuthRequest, res: Response) => {
  try {
    const { amount, givenBy, transactionDate, notes } = req.body ?? {};
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number." });
    }
    if (!givenBy?.trim()) {
      return res.status(400).json({ message: "Given by / Source name is required." });
    }
    if (!transactionDate || Number.isNaN(Date.parse(transactionDate))) {
      return res.status(400).json({ message: "Valid transaction date is required." });
    }

    const reserve = await prisma.expenseReserve.create({
      data: {
        amount: Number(amount),
        givenBy: givenBy.trim(),
        transactionDate: new Date(transactionDate),
        notes: notes?.trim() || null,
        createdById: Number(req.user.userId ?? req.user.id),
      },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });

    void logAudit({
      req,
      action: "ADD_EXPENSE_RESERVE" as any,
      tag: "FEE" as any,
      details: `Added ₹${amount} to cash reserve from "${givenBy.trim()}"`,
      entityType: "ExpenseReserve",
      entityId: reserve.id,
    });

    const summary = await calculateReserveSummary();

    return res.status(201).json({
      message: "Reserve added successfully",
      data: { ...reserve, amount: reserve.amount.toString() },
      summary,
    });
  } catch (err: any) {
    console.error("POST /expenses/reserves error:", err);
    return res.status(500).json({ message: err?.message || "Unable to add reserve" });
  }
});

router.put("/reserves/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expenseReserve.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Reserve entry not found" });

    const { amount, givenBy, transactionDate, notes } = req.body ?? {};
    if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
      return res.status(400).json({ message: "Amount must be a positive number." });
    }
    if (transactionDate && Number.isNaN(Date.parse(transactionDate))) {
      return res.status(400).json({ message: "Valid transaction date is required." });
    }

    const updated = await prisma.expenseReserve.update({
      where: { id },
      data: {
        ...(amount !== undefined ? { amount: Number(amount) } : {}),
        ...(givenBy?.trim() ? { givenBy: givenBy.trim() } : {}),
        ...(transactionDate ? { transactionDate: new Date(transactionDate) } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
      },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });

    void logAudit({
      req,
      action: "UPDATE_EXPENSE_RESERVE" as any,
      tag: "FEE" as any,
      details: `Updated reserve entry #${id} (₹${updated.amount})`,
      entityType: "ExpenseReserve",
      entityId: updated.id,
    });

    const summary = await calculateReserveSummary();

    return res.json({
      message: "Reserve updated successfully",
      data: { ...updated, amount: updated.amount.toString() },
      summary,
    });
  } catch (err: any) {
    console.error("PUT /expenses/reserves/:id error:", err);
    return res.status(500).json({ message: err?.message || "Unable to update reserve" });
  }
});

router.delete("/reserves/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expenseReserve.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Reserve entry not found" });

    await prisma.expenseReserve.delete({ where: { id } });

    void logAudit({
      req,
      action: "DELETE_EXPENSE_RESERVE" as any,
      tag: "FEE" as any,
      details: `Deleted reserve entry #${id} (₹${existing.amount}) given by "${existing.givenBy}"`,
      entityType: "ExpenseReserve",
      entityId: id,
    });

    const summary = await calculateReserveSummary();

    return res.json({
      message: "Reserve deleted successfully",
      data: { id },
      summary,
    });
  } catch (err: any) {
    console.error("DELETE /expenses/reserves/:id error:", err);
    return res.status(500).json({ message: err?.message || "Unable to delete reserve" });
  }
});

// ─── Expense Endpoints ────────────────────────────────────────────────────────

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

router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Expense not found" });

    const { title, category, amount, transactionDate, paymentMode, onlineAccount, notes, billBase64, billMimeType } = req.body ?? {};
    if (category && !categories.includes(category)) {
      return res.status(400).json({ message: "Invalid category." });
    }
    if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
      return res.status(400).json({ message: "Amount must be a positive number." });
    }
    if (transactionDate && Number.isNaN(Date.parse(transactionDate))) {
      return res.status(400).json({ message: "Invalid transaction date." });
    }
    if (paymentMode && !["CASH", "ONLINE"].includes(paymentMode)) {
      return res.status(400).json({ message: "Payment mode must be Cash or Online." });
    }
    const finalMode = paymentMode || existing.paymentMode;
    if (finalMode === "ONLINE" && onlineAccount && !onlineAccounts.includes(onlineAccount)) {
      return res.status(400).json({ message: "Invalid online account." });
    }

    let bill: { billUrl: string; billPath: string; billMimeType: string } | undefined;
    if (billBase64) {
      bill = await uploadExpenseBill({
        imageBase64: billBase64,
        imageMimeType: billMimeType,
        path: `expenses/${req.user.userId ?? req.user.id}_${Date.now()}`
      });
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(category ? { category } : {}),
        ...(amount !== undefined ? { amount: Number(amount) } : {}),
        ...(transactionDate ? { transactionDate: new Date(transactionDate) } : {}),
        ...(paymentMode ? { paymentMode } : {}),
        ...(finalMode === "ONLINE" ? { onlineAccount: onlineAccount || existing.onlineAccount } : { onlineAccount: null }),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(bill ?? {}),
      },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });

    void logAudit({
      req,
      action: "UPDATE_EXPENSE" as any,
      tag: "FINANCE" as any,
      details: `Updated expense #${id} "${updated.title}" for ₹${updated.amount}`,
      entityType: "Expense",
      entityId: updated.id
    });

    return res.json({ message: "Expense updated successfully", data: { ...updated, amount: updated.amount.toString() } });
  } catch (err: any) {
    console.error("PUT /expenses/:id error:", err);
    return res.status(500).json({ message: err?.message || "Unable to update expense" });
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Expense not found" });

    await prisma.expense.delete({ where: { id } });

    void logAudit({
      req,
      action: "DELETE_EXPENSE" as any,
      tag: "FINANCE" as any,
      details: `Deleted expense #${id} "${existing.title}" (₹${existing.amount})`,
      entityType: "Expense",
      entityId: id
    });

    return res.json({ message: "Expense deleted successfully", data: { id } });
  } catch (err: any) {
    console.error("DELETE /expenses/:id error:", err);
    return res.status(500).json({ message: err?.message || "Unable to delete expense" });
  }
});

export default router;

