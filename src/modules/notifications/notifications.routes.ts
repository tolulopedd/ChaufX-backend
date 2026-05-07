import { Router } from "express";
import { asyncHandler } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth);

notificationsRoutes.get(
  "/notifications",
  asyncHandler(async (request, response) => {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: request.auth!.userId
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 50
    });

    response.json(notifications);
  })
);
