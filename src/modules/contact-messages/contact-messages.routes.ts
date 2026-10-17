import { ContactMessageReplyAuthor, ContactMessageStatus } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createAuditLog } from "../../lib/audit.js";
import { sendTransactionalEmail } from "../../lib/email.js";
import { env } from "../../config/env.js";

export const contactMessageRoutes = Router();

function hashFeedbackToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createFeedbackToken() {
  return randomBytes(32).toString("base64url");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}

function feedbackLink(token: string) {
  const url = new URL("/feedback", env.CLIENT_APP_URL);
  url.searchParams.set("thread", token);
  return url.toString();
}

const conversationInclude = {
  replies: {
    orderBy: { createdAt: "asc" as const },
    include: { adminUser: { select: { fullName: true } } }
  }
};

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
      ],
      include: conversationInclude
    });

    response.json(messages);
  })
);

contactMessageRoutes.post(
  "/admin/contact-messages/:messageId/replies",
  requireAuth,
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const messageId = paramValue(request.params.messageId);
    const input = z.object({ message: z.string().trim().min(1).max(2000) }).parse(request.body);
    const contactMessage = await prisma.contactMessage.findUnique({ where: { id: messageId } });

    if (!contactMessage) {
      throw new AppError("Contact message not found", 404, "CONTACT_MESSAGE_NOT_FOUND");
    }

    const token = createFeedbackToken();
    const tokenHash = hashFeedbackToken(token);
    // A batch transaction does not hold a connection open while a callback is
    // scheduled, which is more reliable for the production hosted database.
    const [, reply] = await prisma.$transaction([
      // Rotate the bearer link with each outgoing email so an older forwarded
      // link cannot continue to expose the conversation.
      prisma.contactMessage.update({ where: { id: contactMessage.id }, data: { feedbackTokenHash: tokenHash } }),
      prisma.contactMessageReply.create({
        data: {
          contactMessageId: contactMessage.id,
          author: ContactMessageReplyAuthor.ADMIN,
          message: input.message,
          adminUserId: request.auth!.userId
        }
      })
    ]);

    const replyUrl = feedbackLink(token);

    try {
      await sendTransactionalEmail({
        to: contactMessage.email,
        subject: `Re: ${contactMessage.subject ?? "Your ChaufX message"}`,
        html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.7;max-width:620px;margin:0 auto;"><p>Hello ${escapeHtml(contactMessage.fullName)},</p><p>The ChaufX Team replied:</p><div style="margin:16px 0;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-line;">${escapeHtml(input.message)}</div><p>Use the secure link below to read the conversation and reply to the ChaufX Team.</p><p><a href="${replyUrl}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;">Reply to ChaufX</a></p><p style="color:#64748b;font-size:13px;">This link is personal to this conversation. Do not forward it.</p></div>`,
        text: `Hello ${contactMessage.fullName},\n\nThe ChaufX Team replied:\n\n${input.message}\n\nRead the conversation and reply securely: ${replyUrl}\n\nDo not forward this personal link.`
      });
      await prisma.contactMessageReply.update({ where: { id: reply.id }, data: { emailSentAt: new Date() } });
    } catch (error) {
      throw new AppError(error instanceof Error ? `Reply saved, but email delivery failed: ${error.message}` : "Reply saved, but email delivery failed.", 502, "EMAIL_DELIVERY_FAILED");
    }

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "CONTACT_MESSAGE_REPLIED",
      entityType: "ContactMessage",
      entityId: contactMessage.id
    });

    response.status(201).json(await prisma.contactMessageReply.findUniqueOrThrow({
      where: { id: reply.id },
      include: { adminUser: { select: { fullName: true } } }
    }));
  })
);

contactMessageRoutes.get(
  "/contact-messages/feedback/:token",
  asyncHandler(async (request, response) => {
    const token = z.string().min(32).max(256).parse(paramValue(request.params.token));
    const contactMessage = await prisma.contactMessage.findUnique({
      where: { feedbackTokenHash: hashFeedbackToken(token) },
      include: conversationInclude
    });
    if (!contactMessage) throw new AppError("This feedback link is invalid or no longer available.", 404, "FEEDBACK_LINK_INVALID");

    response.json({
      subject: contactMessage.subject ?? "Message to ChaufX",
      entries: [
        { author: "CONTACT", message: contactMessage.message, createdAt: contactMessage.createdAt, displayName: contactMessage.fullName },
        ...contactMessage.replies.map((reply) => ({ author: reply.author, message: reply.message, createdAt: reply.createdAt, displayName: reply.author === ContactMessageReplyAuthor.ADMIN ? "ChaufX Team" : contactMessage.fullName }))
      ]
    });
  })
);

contactMessageRoutes.post(
  "/contact-messages/feedback/:token/replies",
  asyncHandler(async (request, response) => {
    const token = z.string().min(32).max(256).parse(paramValue(request.params.token));
    const input = z.object({ message: z.string().trim().min(1).max(2000) }).parse(request.body);
    const contactMessage = await prisma.contactMessage.findUnique({ where: { feedbackTokenHash: hashFeedbackToken(token) } });
    if (!contactMessage) throw new AppError("This feedback link is invalid or no longer available.", 404, "FEEDBACK_LINK_INVALID");

    const [, reply] = await prisma.$transaction([
      prisma.contactMessage.update({
        where: { id: contactMessage.id },
        data: { status: ContactMessageStatus.NEW, resolvedAt: null, resolvedByUserId: null }
      }),
      prisma.contactMessageReply.create({
        data: { contactMessageId: contactMessage.id, author: ContactMessageReplyAuthor.CONTACT, message: input.message }
      })
    ]);

    response.status(201).json(reply);
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
