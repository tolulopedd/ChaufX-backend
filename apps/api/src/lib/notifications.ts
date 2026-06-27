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
    return;
  }

  const dataPayload =
    notification.meta && typeof notification.meta === "object" && !Array.isArray(notification.meta)
      ? notification.meta
      : {};

  const tickets = await sendExpoPush(
    devices.map((device) => ({
      to: device.expoPushToken,
      sound: "default",
      title: notification.title,
      body: notification.body,
      priority: "high",
      channelId: "default",
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

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: NotificationStatus.SENT
    }
  });
}

export async function notifyUser(params: NotifyUserParams) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      channel: params.channel,
      status: params.status ?? (params.channel === NotificationChannel.PUSH ? NotificationStatus.PENDING : NotificationStatus.SENT),
      meta: params.meta
    }
  });

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
