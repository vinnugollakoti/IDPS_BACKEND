import { Router, Response } from "express";
import prisma from "../prisma/client";
import { auth, AuthRequest, isExecutiveRole } from "../middleware/auth";
import { serverCache } from "../utils/cache";

const router = Router();

// GET /permission/staff - List all staff users (TEACHER, RECEPTIONIST, PRINCIPAL) with permission status
router.get("/staff", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !isExecutiveRole(req.user.role)) {
      return res.status(403).json({ message: "Access restricted to Executive roles (Director, Chairman, Principal)" });
    }

    // Fetch all non-PARENT users (staff members)
    const staffUsers = await prisma.user.findMany({
      where: {
        role: {
          in: ["PRINCIPAL", "RECEPTIONIST", "TEACHER"],
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        gender: true,
        teacher: {
          select: {
            id: true,
            phone: true,
            salary: true,
          },
        },
        userPermissions: {
          select: {
            module: true,
            isAllowed: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    // Format output with staffId, department, badge, allowedModules
    const formattedStaff = staffUsers.map((user) => {
      let department = "Administration";
      let badge = "Staff Member";
      const staffId = `ST-${String(user.id).padStart(3, "0")}`;

      if (user.role === "PRINCIPAL") {
        department = "Executive Admin";
        badge = "Super Admin";
      } else if (user.role === "RECEPTIONIST") {
        department = "Front Desk & Lobby";
        badge = "Lobby Access";
      } else if (user.role === "TEACHER") {
        department = "Academic Faculty";
        badge = "Faculty Staff";
      }

      // Default module access per role if no custom permissions recorded yet
      let allowedModules: string[] = [];

      if (user.userPermissions && user.userPermissions.length > 0) {
        allowedModules = user.userPermissions
          .filter((p) => p.isAllowed)
          .map((p) => p.module);
      } else {
        // Fallback default permissions by role
        if (user.role === "PRINCIPAL") {
          allowedModules = [
            "students",
            "fees",
            "circulars",
            "exams",
            "classes",
            "attendance",
            "timetable",
            "notifications",
          ];
        } else if (user.role === "RECEPTIONIST") {
          allowedModules = ["students", "attendance"];
        } else if (user.role === "TEACHER") {
          allowedModules = [
            "students",
            "circulars",
            "exams",
            "classes",
            "attendance",
            "timetable",
          ];
        }
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        gender: user.gender,
        staffId,
        department,
        badge,
        allowedModules,
        phone: user.teacher?.phone,
      };
    });

    return res.json({
      message: "Staff list with permissions fetched successfully",
      data: formattedStaff,
    });
  } catch (err: any) {
    console.error("Error fetching staff permissions:", err);
    return res.status(500).json({ message: "Failed to fetch staff permissions", error: err?.message });
  }
});

// GET /permission/user/:userId - Fetch permissions for a single user
router.get("/user/:userId", auth, async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.userId, 10);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const permissions = await prisma.userPermission.findMany({
      where: { userId: targetUserId, isAllowed: true },
      select: { module: true },
    });

    return res.json({
      message: "User permissions fetched successfully",
      data: permissions.map((p) => p.module),
    });
  } catch (err: any) {
    console.error("Error fetching user permissions:", err);
    return res.status(500).json({ message: "Failed to fetch user permissions", error: err?.message });
  }
});

// POST /permission/update - Update allowed modules for a staff user
router.post("/update", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== "DIRECTOR" && req.user.role !== "CHAIRMAN" && req.user.role !== "PRINCIPAL")) {
      return res.status(403).json({ message: "Only Director, Chairman, or Principal can update user permissions" });
    }

    const { targetUserId, allowedModules } = req.body;

    if (!targetUserId || !Array.isArray(allowedModules)) {
      return res.status(400).json({ message: "targetUserId (number) and allowedModules (array of strings) are required" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, role: true },
    });

    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const ALL_MODULES = [
      "students",
      "fees",
      "circulars",
      "exams",
      "classes",
      "attendance",
      "timetable",
      "notifications",
      "permission",
      "homework",
      "whatsapp",
      "profile",
    ];

    // Transaction to update all module states for this user
    await prisma.$transaction(
      ALL_MODULES.map((moduleKey) => {
        const isAllowed = allowedModules.includes(moduleKey);
        return prisma.userPermission.upsert({
          where: {
            userId_module: {
              userId: targetUserId,
              module: moduleKey,
            },
          },
          update: {
            isAllowed,
          },
          create: {
            userId: targetUserId,
            module: moduleKey,
            isAllowed,
          },
        });
      })
    );

    // Create Audit Log
    try {
      await prisma.auditLog.create({
        data: {
          action: "UPDATE_PERMISSIONS",
          tag: "AUTH",
          details: `Updated app permissions for ${targetUser.name} (${targetUser.role}). Allowed: ${allowedModules.join(", ")}`,
          entityType: "UserPermission",
          entityId: String(targetUserId),
          performedById: req.user.userId || req.user.id,
          performedByRole: req.user.role,
        },
      });
    } catch (auditErr) {
      console.warn("Audit log creation warning:", auditErr);
    }

    // Invalidate permission and classes caches for instant device synchronization
    serverCache.invalidate("permission");
    serverCache.invalidate("get-classes");

    return res.json({
      message: `Permissions updated successfully for ${targetUser.name}`,
      data: {
        userId: targetUserId,
        allowedModules,
      },
    });
  } catch (err: any) {
    console.error("Error updating permissions:", err);
    return res.status(500).json({ message: "Failed to update permissions", error: err?.message });
  }
});

export default router;
