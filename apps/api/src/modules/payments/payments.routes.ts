import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const paymentsRoutes = Router();

paymentsRoutes.use(requireAuth);

paymentsRoutes.post(
  "/payments/:bookingId/record",
  requireRole(["admin", "customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      amount: z.coerce.number().positive(),
      providerReference: z.string().optional(),
      notes: z.string().optional()
    });
    const input = schema.parse(request.body);

    const payment = await prisma.payment.upsert({
      where: {
        bookingId
      },
      create: {
        bookingId,
        amount: input.amount,
        status: "RECORDED",
        providerReference: input.providerReference,
        notes: input.notes,
        recordedAt: new Date()
      },
      update: {
        amount: input.amount,
        status: "RECORDED",
        providerReference: input.providerReference,
        notes: input.notes,
        recordedAt: new Date()
      }
    });

    response.json(payment);
  })
);
