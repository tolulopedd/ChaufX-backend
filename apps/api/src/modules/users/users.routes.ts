import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const usersRoutes = Router();

usersRoutes.use(requireAuth);

usersRoutes.get(
  "/users/me",
  asyncHandler(async (request, response) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.auth!.userId },
      include: {
        customerProfile: {
          include: {
            vehicles: true
          }
        },
        driver: true,
        adminUser: true
      }
    });

    response.json(user);
  })
);

usersRoutes.patch(
  "/users/me",
  asyncHandler(async (request, response) => {
    const schema = z.object({
      fullName: z.string().min(2).optional(),
      phone: z.string().min(7).optional(),
      savedAddresses: z.array(z.string()).optional()
    });
    const input = schema.parse(request.body);

    const updated = await prisma.user.update({
      where: { id: request.auth!.userId },
      data: {
        fullName: input.fullName,
        phone: input.phone,
        customerProfile: input.savedAddresses
          ? {
              upsert: {
                create: {
                  savedAddresses: input.savedAddresses
                },
                update: {
                  savedAddresses: input.savedAddresses
                }
              }
            }
          : undefined
      },
      include: {
        customerProfile: true
      }
    });

    response.json(updated);
  })
);

usersRoutes.post(
  "/users/me/vehicles",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      make: z.string().min(2),
      model: z.string().min(1),
      plateNumber: z.string().min(3),
      color: z.string().optional(),
      notes: z.string().optional()
    });
    const input = schema.parse(request.body);

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: {
        userId: request.auth!.userId
      }
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: customer.id,
        ...input
      }
    });

    response.status(201).json(vehicle);
  })
);
