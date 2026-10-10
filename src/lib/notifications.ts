import { NotificationChannel, NotificationStatus, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type NotificationMeta = Prisma.InputJsonValue | undefined;

type NotifyUserParams = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  channel: NotificationChannel;
  status?: NotificationStatus;
  meta?: NotificationMeta;
  dedupeKey?: string;
};

type ExpoTicket = {
  status?: "ok" | "error";
  details?: {
    error?: string;
  };
};

async function sendExpoPush(messages: Array<Record<string, unknown>>) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(messages)
  });

  if (!response.ok) {
    throw new Error(`Expo push failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { data?: ExpoTicket[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

async function deliverPushNotification(notificationId: string) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification || notification.channel !== NotificationChannel.PUSH) {
    return;
  }

  const devices = await prisma.pushDevice.findMany({
    where: {
      userId: notification.userId,
      disabledAt: null
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (!devices.length) {
    console.info("notification_delivery", JSON.stringify({ notificationId, userId: notification.userId, outcome: "no_active_device" }));
    return;
  }

  const dataPayload =
    notification.meta && typeof notification.meta === "object" && !Array.isArray(notification.meta)
      ? notification.meta
      : {};

  const expiresAt = typeof (dataPayload as Record<string, unknown>).expiresAt === "string"
    ? new Date((dataPayload as Record<string, string>).expiresAt).getTime()
    : null;
  const ttl = expiresAt && Number.isFinite(expiresAt) ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : undefined;
  const bookingRequest = notification.type === "BOOKING_SUBMITTED" && Boolean((dataPayload as Record<string, unknown>).dispatchId);
  const tickets = await sendExpoPush(
    devices.map((device) => ({
      to: device.expoPushToken,
      sound: "default",
      title: notification.title,
      body: notification.body,
      priority: "high",
      channelId: bookingRequest ? "booking-requests" : "default",
      categoryId: bookingRequest ? "BOOKING_REQUEST" : undefined,
      ttl,
      data: {
        notificationId: notification.id,
        type: notification.type,
        ...dataPayload
      }
    }))
  );

  const invalidTokens = devices
    .map((device, index) => ({ device, ticket: tickets[index] }))
    .filter(({ ticket }) => ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered")
    .map(({ device }) => device.expoPushToken);

  if (invalidTokens.length) {
    await prisma.pushDevice.updateMany({
      where: {
        expoPushToken: {
          in: invalidTokens
        }
      },
      data: {
        disabledAt: new Date()
      }
    });
  }

  const successfulDeliveries = tickets.filter((ticket) => ticket?.status === "ok").length;
  console.info(
    "notification_delivery",
    JSON.stringify({ notificationId, userId: notification.userId, devices: devices.length, successfulDeliveries, invalidTokens: invalidTokens.length })
  );

  if (!successfulDeliveries) {
    throw new Error(`Push notification ${notification.id} was not accepted by any registered device`);
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: NotificationStatus.SENT
    }
  });
}

export async function notifyUser(params: NotifyUserParams) {
  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        channel: params.channel,
        status: params.status ?? (params.channel === NotificationChannel.PUSH ? NotificationStatus.PENDING : NotificationStatus.SENT),
        meta: params.meta,
        dedupeKey: params.dedupeKey
      }
    });
  } catch (error) {
    if (params.dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.notification.findUnique({ where: { dedupeKey: params.dedupeKey } });
      if (existing) {
        console.info("notification_deduplicated", JSON.stringify({ dedupeKey: params.dedupeKey, notificationId: existing.id }));
        return existing;
      }
    }
    throw error;
  }

  if (params.channel === NotificationChannel.PUSH) {
    await deliverPushNotification(notification.id).catch((error) => {
      console.error("Unable to deliver push notification", error);
    });
  }

  return notification;
}

export async function notifyUsers(params: NotifyUserParams[]) {
  const notifications = await Promise.all(params.map((item) => notifyUser(item)));
  return notifications;
}

export async function retryPendingPushNotifications(limit = 50) {
  const pending = await prisma.notification.findMany({
    where: {
      channel: NotificationChannel.PUSH,
      status: NotificationStatus.PENDING,
      createdAt: { gte: new Date(Date.now() - 5 * 60_000) }
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  for (const notification of pending) {
    const meta = notification.meta && typeof notification.meta === "object" && !Array.isArray(notification.meta)
      ? notification.meta as Record<string, unknown>
      : {};
    const expiresAt = typeof meta.expiresAt === "string" ? new Date(meta.expiresAt).getTime() : null;
    if (expiresAt && expiresAt <= Date.now()) {
      await prisma.notification.update({ where: { id: notification.id }, data: { status: NotificationStatus.SENT } });
      continue;
    }
    await deliverPushNotification(notification.id).catch((error) => {
      console.error("notification_retry_failure", JSON.stringify({ notificationId: notification.id, message: error instanceof Error ? error.message : "Unknown error" }));
    });
  }
}
