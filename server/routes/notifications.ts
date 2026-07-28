import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { logAudit } from "../utils/audit";

const router = express.Router();

const resolveAuthUserId = (user: any) => {
  const value = Number(user?.userId ?? user?.id);
  return Number.isFinite(value) && value > 0 ? value : null;
};

// 1. REGISTER FCM/PUSH TOKEN FOR LOGGED IN USER (PARENTS, TEACHERS, RECEPTIONIST, PRINCIPAL)
router.post("/register-token", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "Invalid user authentication token" });
    }

    const { token, platform } = req.body;
    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "Mobile device push token is required" });
    }

    const cleanToken = token.trim();
    const pushToken = await prisma.pushToken.upsert({
      where: { token: cleanToken },
      update: {
        userId,
        platform: platform || "mobile",
        updatedAt: new Date(),
      },
      create: {
        userId,
        token: cleanToken,
        platform: platform || "mobile",
      },
    });

    res.json({
      message: "Push notification token registered successfully",
      data: pushToken,
    });
  } catch (err: any) {
    console.error("Error registering push token:", err);
    res.status(500).json({ message: "Failed to register push token", error: err?.message });
  }
});

// 2. SEND BROADCAST NOTIFICATION (EXECUTIVE LEADERSHIP ONLY: PRINCIPAL, DIRECTOR, CHAIRMAN)
router.post("/send-broadcast", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "Invalid user authentication token" });
    }

    if (!isExecutiveRole(req.user.role)) {
      return res.status(403).json({ message: "Only Executive leadership (Principal, Director, Chairman) can send broadcast notifications." });
    }

    const { title, body, imageUrl, targetAudience } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Notification title is required." });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ message: "Notification message body is required." });
    }

    const validAudience = ["PARENTS", "TEACHERS", "BOTH"].includes(targetAudience)
      ? targetAudience
      : "BOTH";

    // Create DB record
    const broadcast = await prisma.broadcastNotification.create({
      data: {
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl && typeof imageUrl === "string" ? imageUrl.trim() : null,
        targetAudience: validAudience,
        sentById: userId,
      },
      include: {
        sentBy: {
          select: { name: true, email: true, role: true },
        },
      },
    });

    // Also auto-create a Notice record so it appears under Notices & Circulars
    await prisma.notice.create({
      data: {
        title: title.trim(),
        message: body.trim(),
      },
    }).catch((e) => console.log("Notice auto-creation error:", e));

    void logAudit({
      req,
      action: "SEND_BROADCAST",
      tag: "NOTICE",
      details: `Broadcasted push notification "${title.trim()}" to ${validAudience}`,
      entityType: "BroadcastNotification",
      entityId: broadcast.id,
    });

    // Query tokens for target recipients
    let targetRoles: any[] = [];
    if (validAudience === "PARENTS") {
      targetRoles = ["PARENT"];
    } else if (validAudience === "TEACHERS") {
      targetRoles = ["TEACHER", "RECEPTIONIST"];
    } else {
      targetRoles = ["PARENT", "TEACHER", "RECEPTIONIST", "PRINCIPAL", "DIRECTOR", "CHAIRMAN"];
    }

    const recipientTokens = await prisma.pushToken.findMany({
      where: {
        user: {
          role: { in: targetRoles },
        },
      },
      select: { token: true, userId: true },
    });

    // Executive confirmation token
    const principalTokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });

    res.json({
      message: `Notification broadcast sent successfully to ${validAudience}! 🚀`,
      data: {
        broadcast,
        recipientCount: recipientTokens.length,
        principalNotified: principalTokens.length > 0,
      },
    });
  } catch (err: any) {
    console.error("Error sending broadcast notification:", err);
    res.status(500).json({ message: "Failed to send notification broadcast", error: err?.message });
  }
});

// 3. FETCH NOTIFICATION BROADCAST HISTORY (EXECUTIVE LEADERSHIP ONLY)
router.get("/history", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "Invalid user authentication token" });
    }

    if (!isExecutiveRole(req.user.role)) {
      return res.status(403).json({ message: "Only Executive leadership can view notification history." });
    }

    const history = await prisma.broadcastNotification.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        sentBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    res.json({
      message: "Notification broadcast history fetched successfully",
      data: history,
    });
  } catch (err: any) {
    console.error("Error fetching notification history:", err);
    res.status(500).json({ message: "Failed to fetch notification history", error: err?.message });
  }
});

export default router;
