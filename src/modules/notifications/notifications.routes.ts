import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { paramValue } from "../../lib/http.js";

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth);

const registerPushDeviceSchema = z.object({
  expoPushToken: z.string().min(10),
  platform: z.enum(["ios", "android"]),
  appVariant: z.enum(["customer", "driver"])
});

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

notificationsRoutes.post(
  "/notifications/devices",
  asyncHandler(async (request, response) => {
    const input = registerPushDeviceSchema.parse(request.body);

    const device = await prisma.pushDevice.upsert({
      where: {
        expoPushToken: input.expoPushToken
      },
      update: {
        userId: request.auth!.userId,
        platform: input.platform,
        appVariant: input.appVariant,
        disabledAt: null,
        lastSeenAt: new Date()
      },
      create: {
        userId: request.auth!.userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        appVariant: input.appVariant,
        lastSeenAt: new Date()
      }
    });

    response.status(201).json(device);
  })
);

notificationsRoutes.delete(
  "/notifications/devices/:token",
  asyncHandler(async (request, response) => {
    const token = paramValue(request.params.token);

    await prisma.pushDevice.updateMany({
      where: {
        expoPushToken: token,
        userId: request.auth!.userId
      },
      data: {
        disabledAt: new Date()
      }
    });

    response.status(204).send();
  })
);

notificationsRoutes.post(
  "/notifications/:notificationId/read",
  asyncHandler(async (request, response) => {
    const notificationId = paramValue(request.params.notificationId);
    const notification = await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: request.auth!.userId
      },
      data: {
        status: "READ",
        readAt: new Date()
      }
    });

    response.json({
      success: Boolean(notification.count)
    });
  })
);
