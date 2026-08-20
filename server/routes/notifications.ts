import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { logAudit } from "../utils/audit";
import { uploadNotificationImage } from "../lib/supabaseStorage";
import webpush, { PushSubscription } from "web-push";

const router = express.Router();

const getWebPushConfig = () => {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const configured = Boolean(publicKey && privateKey);
  if (configured) webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT ?? "mailto:chairman@idps.com", publicKey!, privateKey!);
  return { publicKey, configured };
};

const resolveAuthUserId = (user: any) => {
  const value = Number(user?.userId ?? user?.id);
  return Number.isFinite(value) && value > 0 ? value : null;
};

// ─── Helper: fetch push tokens by audience ────────────────────────────────────

const fetchTokensByAudience = async (audience: "PARENTS" | "TEACHERS" | "BOTH") => {
  if (audience === "BOTH") {
    // All tokens in the DB regardless of role
    const rows = await prisma.pushToken.findMany({
      select: { token: true, userId: true, platform: true },
    });
    console.log(`[Tokens] BOTH → fetched ${rows.length} token(s) from PushToken table`);
    return rows;
  }

  const roleMap: Record<"PARENTS" | "TEACHERS", string[]> = {
    PARENTS: ["PARENT"],
    TEACHERS: ["TEACHER", "RECEPTIONIST", "PRINCIPAL", "DIRECTOR", "CHAIRMAN"],
  };
  const roles = roleMap[audience];

  const rows = await prisma.pushToken.findMany({
    where: { user: { role: { in: roles as any[] } } },
    select: { token: true, userId: true, platform: true },
  });
  console.log(`[Tokens] ${audience} (roles: ${roles.join(", ")}) → fetched ${rows.length} token(s)`);
  return rows;
};

// ─── 1. Register push token ───────────────────────────────────────────────────

router.post("/register-token", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid user authentication token" });

    const { token, platform } = req.body;
    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "Mobile device push token is required" });
    }

    const cleanToken = token.trim();
    console.log(`[Register Token] userId=${userId} token=${cleanToken} platform=${platform}`);

    const pushToken = await prisma.pushToken.upsert({
      where: { token: cleanToken },
      update: { userId, platform: platform || "android", updatedAt: new Date() },
      create: { userId, token: cleanToken, platform: platform || "android" },
    });

    res.json({ message: "Push token registered successfully", data: pushToken });
  } catch (err: any) {
    console.error("[Register Token Error]:", err?.message);
    res.status(500).json({ message: "Failed to register push token", error: err?.message });
  }
});

// ─── 1b. Register an installed PWA Web Push subscription ─────────────────────

router.get("/web-push-config", auth, async (_req: AuthRequest, res: Response) => {
  const { publicKey, configured } = getWebPushConfig();
  if (!configured) {
    return res.status(503).json({ message: "Web Push is not configured on the server." });
  }
  res.json({ data: { publicKey } });
});

router.post("/register-web-subscription", auth, async (req: AuthRequest, res: Response) => {
  try {
    const { configured } = getWebPushConfig();
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid user authentication token" });
    if (!configured) return res.status(503).json({ message: "Web Push is not configured on the server." });

    const subscription = req.body?.subscription as Partial<PushSubscription> | undefined;
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return res.status(400).json({ message: "A valid browser push subscription is required." });
    }

    const token = JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys });
    const saved = await prisma.pushToken.upsert({
      where: { token },
      update: { userId, platform: "web", updatedAt: new Date() },
      create: { userId, token, platform: "web" },
    });
    res.json({ message: "Web Push subscription registered", data: { id: saved.id } });
  } catch (err: any) {
    console.error("[Register Web Push Error]:", err?.message);
    res.status(500).json({ message: "Failed to register Web Push subscription" });
  }
});

// ─── 2. Upload notification image → Supabase notification-images bucket ───────

router.post("/upload-image", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid user authentication token" });

    const { imageBase64, imageMimeType } = req.body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ message: "imageBase64 is required" });
    }

    console.log(`[Upload Image] userId=${userId} mimeHint=${imageMimeType ?? "none"} payloadLen=${imageBase64.length}`);

    const path = `notifications/${userId}_${Date.now()}`;
    const result = await uploadNotificationImage({ imageBase64, imageMimeType, path });

    res.json({ message: "Notification image uploaded successfully", data: result });
  } catch (err: any) {
    console.error("[Upload Image Error]:", err?.message);
    res.status(500).json({
      message: "Failed to upload notification image",
      error: err?.message || "Unknown error",
    });
  }
});

// ─── 3. GET tokens by audience (debug / frontend use) ────────────────────────

router.get("/tokens", auth, async (req: AuthRequest, res: Response) => {
  try {
    const audience = (req.query.audience as string ?? "BOTH").toUpperCase();
    if (!["PARENTS", "TEACHERS", "BOTH"].includes(audience)) {
      return res.status(400).json({ message: "audience must be PARENTS, TEACHERS, or BOTH" });
    }
    const tokens = await fetchTokensByAudience(audience as any);
    res.json({ message: `Found ${tokens.length} token(s) for "${audience}"`, data: tokens });
  } catch (err: any) {
    console.error("[GET /tokens Error]:", err?.message);
    res.status(500).json({ message: "Failed to fetch tokens", error: err?.message });
  }
});

// ─── 4. Send broadcast notification ──────────────────────────────────────────

router.post("/send-broadcast", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid user authentication token" });

    if (!isExecutiveRole(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only Principal, Director, or Chairman can send broadcast notifications." });
    }

    const { title, body, imageUrl, targetAudience } = req.body;

    if (!title?.trim()) return res.status(400).json({ message: "Notification title is required" });
    if (!body?.trim()) return res.status(400).json({ message: "Notification body is required" });

    const validAudience: "PARENTS" | "TEACHERS" | "BOTH" = ["PARENTS", "TEACHERS", "BOTH"].includes(
      targetAudience
    )
      ? targetAudience
      : "BOTH";

    const cleanImageUrl =
      typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : undefined;

    // ── Persist broadcast record ──
    const broadcast = await prisma.broadcastNotification.create({
      data: {
        title: title.trim(),
        body: body.trim(),
        imageUrl: cleanImageUrl ?? null,
        targetAudience: validAudience,
        sentById: userId,
      },
      include: { sentBy: { select: { name: true, email: true, role: true } } },
    });

    // ── Auto-create notice ──
    await prisma.notice
      .create({ data: { title: title.trim(), message: body.trim(), imageUrl: cleanImageUrl ?? null } })
      .catch((e) => console.warn("[Notice auto-create]:", e?.message));

    void logAudit({
      req,
      action: "SEND_BROADCAST",
      tag: "NOTICE",
      details: `Broadcasted "${title.trim()}" to ${validAudience}`,
      entityType: "BroadcastNotification",
      entityId: broadcast.id,
    });

    // ── Fetch target push tokens ──
    const recipientTokens = await fetchTokensByAudience(validAudience);

    // ── Build Expo push payloads with Rich Content & High-Level FCM properties ──
    const webTargets = recipientTokens.filter((item) => item.platform === "web");
    const mobileTargets = recipientTokens.filter((item) => item.platform !== "web");
    const expoPushMessages = mobileTargets
      .map((r) => r.token.trim())
      .filter(Boolean)
      .map((to) => ({
        to,
        sound: "default",
        title: title.trim(),
        body: body.trim(),
        channelId: "default",
        priority: "high",
        badge: 1,
        mutableContent: true,
        data: {
          id: broadcast.id,
          title: title.trim(),
          body: body.trim(),
          image: cleanImageUrl || null,
          imageUrl: cleanImageUrl || null,
          attachmentUrl: cleanImageUrl || null,
          _displayInForeground: true,
        },
        // Expo maps richContent.image to Android's expanded BigPicture style.
        // This keeps the image available in the notification shade without
        // requiring the app to be opened first.
        ...(cleanImageUrl ? { richContent: { image: cleanImageUrl } } : {}),
      }));

    console.log(
      `[Send Broadcast] audience=${validAudience} tokens=${recipientTokens.length} messages=${expoPushMessages.length}`
    );

    // ── Dispatch to Expo Push Service ──
    let pushResponse: any = null;
    if (expoPushMessages.length > 0) {
      try {
        console.log(`[Expo Push] Posting ${expoPushMessages.length} message(s) to exp.host...`);
        const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(expoPushMessages),
        });
        pushResponse = await expoRes.json().catch(() => null);
        console.log("[Expo Push Response]:", JSON.stringify(pushResponse, null, 2));
      } catch (pushErr: any) {
        console.error("[Expo Push Error]:", pushErr?.message);
      }
    } else {
      console.warn(`[Send Broadcast] No push tokens found for audience "${validAudience}"`);
    }

    let pushedToWeb = 0;
    let webPushFailures = 0;
    const { configured: webPushConfigured } = getWebPushConfig();
    if (webTargets.length && webPushConfigured) {
      const webPayload = JSON.stringify({
        id: broadcast.id,
        title: title.trim(),
        body: body.trim(),
        imageUrl: cleanImageUrl || null,
        url: "/?noticeId=" + broadcast.id,
      });
      const results = await Promise.all(webTargets.map(async (target) => {
        try {
          await webpush.sendNotification(JSON.parse(target.token) as PushSubscription, webPayload, { TTL: 86400 });
          return true;
        } catch (error: any) {
          webPushFailures += 1;
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await prisma.pushToken.delete({ where: { token: target.token } }).catch(() => undefined);
          }
          console.warn(`[Web Push] Delivery failed for token ${target.userId}:`, error?.message);
          return false;
        }
      }));
      pushedToWeb = results.filter(Boolean).length;
    }

    res.json({
      message: `Broadcast sent to ${validAudience} successfully 🚀`,
      data: {
        broadcast,
        recipientCount: recipientTokens.length,
        pushedToExpo: expoPushMessages.length,
        pushedToWeb,
        webPushFailures,
        expoResponse: pushResponse,
      },
    });
  } catch (err: any) {
    console.error("[Send Broadcast Error]:", err?.message);
    res.status(500).json({ message: "Failed to send broadcast", error: err?.message });
  }
});

// ─── 5. Notification broadcast history ───────────────────────────────────────

router.get("/history", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid user authentication token" });

    if (!isExecutiveRole(req.user.role)) {
      return res.status(403).json({ message: "Only Executive leadership can view notification history." });
    }

    const history = await prisma.broadcastNotification.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { sentBy: { select: { id: true, name: true, email: true, role: true } } },
    });

    res.json({ message: "Notification history fetched", data: history });
  } catch (err: any) {
    console.error("[Notification History Error]:", err?.message);
    res.status(500).json({ message: "Failed to fetch notification history", error: err?.message });
  }
});

// ─── 6. Notices inbox ────────────────────────────────────────────────────────
// Notices are the school-wide inbox for messages delivered through Notify.
router.post("/notices", auth, async (req: AuthRequest, res: Response) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!title) return res.status(400).json({ message: "Notice title is required" });
    if (!message) return res.status(400).json({ message: "Notice message is required" });

    const imageUrl = typeof req.body?.imageUrl === "string" && req.body.imageUrl.trim()
      ? req.body.imageUrl.trim()
      : null;
    const notice = await prisma.notice.create({ data: { title, message, imageUrl } });
    res.status(201).json({ message: "Notice saved", data: notice });
  } catch (err: any) {
    console.error("[Create Notice Error]:", err?.message);
    res.status(500).json({ message: "Failed to save notice", error: err?.message });
  }
});

router.get("/notices", auth, async (_req: AuthRequest, res: Response) => {
  try {
    const notices = await prisma.notice.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const broadcasts = await prisma.broadcastNotification.findMany({
      select: { title: true, body: true, imageUrl: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const imageByMessage = new Map(
      broadcasts
        .filter((broadcast) => broadcast.imageUrl)
        .map((broadcast) => [`${broadcast.title}\u0000${broadcast.body}`, broadcast.imageUrl])
    );
    const enriched = notices.map((notice) => ({
      ...notice,
      imageUrl: notice.imageUrl ?? imageByMessage.get(`${notice.title}\u0000${notice.message}`) ?? null,
    }));
    res.json({ message: "Notices fetched", data: enriched });
  } catch (err: any) {
    console.error("[Notices Error]:", err?.message);
    res.status(500).json({ message: "Failed to fetch notices", error: err?.message });
  }
});

export default router;
