import { ContactMessageStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createAuditLog } from "../../lib/audit.js";

export const contactMessageRoutes = Router();

contactMessageRoutes.post(
  "/contact-messages",
  asyncHandler(async (request, response) => {
    const schema = z.object({
      fullName: z.string().min(2).max(120),
      email: z.email(),
      province: z.string().min(2).max(80).optional(),
      subject: z.string().min(2).max(120).optional(),
      message: z.string().min(10).max(2000),
      source: z.string().min(2).max(40).optional()
    });

    const input = schema.parse(request.body);

    const contactMessage = await prisma.contactMessage.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        province: input.province,
        subject: input.subject,
        message: input.message,
        source: input.source ?? "website"
      }
    });

    response.status(201).json(contactMessage);
  })
);

contactMessageRoutes.get(
  "/admin/contact-messages",
  requireAuth,
  requireRole(["admin"]),
  asyncHandler(async (_request, response) => {
    const messages = await prisma.contactMessage.findMany({
      orderBy: [
        { status: "asc" },
        { createdAt: "desc" }
      ]
    });

    response.json(messages);
  })
);

contactMessageRoutes.post(
  "/admin/contact-messages/:messageId/status",
  requireAuth,
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const messageId = paramValue(request.params.messageId);
    const schema = z.object({
      status: z.nativeEnum(ContactMessageStatus)
    });
    const { status } = schema.parse(request.body);

    const existing = await prisma.contactMessage.findUnique({
      where: { id: messageId }
    });

    if (!existing) {
      throw new AppError("Contact message not found", 404, "CONTACT_MESSAGE_NOT_FOUND");
    }

    const updated = await prisma.contactMessage.update({
      where: { id: messageId },
      data: {
        status,
        resolvedAt: status === ContactMessageStatus.RESOLVED ? new Date() : null,
        resolvedByUserId: status === ContactMessageStatus.RESOLVED ? request.auth!.userId : null
      }
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "CONTACT_MESSAGE_STATUS_UPDATED",
      entityType: "ContactMessage",
      entityId: updated.id,
      details: {
        status
      }
    });

    response.json(updated);
  })
);
