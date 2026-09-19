import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { persistCustomerIdentityDocument } from "../../lib/document-storage.js";
import { AppError } from "../../common/AppError.js";
import { isEligibleCustomerAge } from "../../lib/customer-age.js";

export const usersRoutes = Router();

usersRoutes.use(requireAuth);

usersRoutes.get(
  "/users/me",
  asyncHandler(async (request, response) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.auth!.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        membershipTier: true,
        membershipStatus: true,
        customerProfile: {
          include: {
            vehicles: {
              orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }]
            },
            identityDocument: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                createdAt: true,
                updatedAt: true
              }
            }
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

usersRoutes.patch(
  "/users/me/customer-profile",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      phone: z.string().trim().regex(/^\+1\d{10}$/).optional(),
      dateOfBirth: z.coerce.date().max(new Date()).optional(),
      primaryAddress: z.string().trim().min(5).max(300).optional(),
      emergencyContactName: z.string().trim().min(2).max(120).optional(),
      emergencyContactPhone: z.string().trim().min(7).max(32).optional(),
      emergencyContactEmail: z.string().trim().email().max(320).optional(),
      vehicle: z
        .object({
          make: z.string().trim().min(2).max(80),
          model: z.string().trim().min(1).max(80),
          plateNumber: z.string().trim().min(3).max(24),
          registrationProvince: z.string().trim().min(2).max(80)
        })
        .optional(),
      vehicleComplianceConfirmed: z.boolean().optional(),
      termsAccepted: z.boolean().optional(),
      privacyPolicyAccepted: z.boolean().optional(),
      identityVerificationConsented: z.boolean().optional(),
      vehicleAuthorityConfirmed: z.boolean().optional(),
      governmentPhotoId: z
        .object({
          fileName: z.string().trim().min(2).max(180),
          fileUrl: z.string().min(20),
          mimeType: z.string().trim().min(3).max(120).optional()
        })
        .optional()
    });
    const input = schema.parse(request.body);
    const now = new Date();

    if (input.dateOfBirth && !isEligibleCustomerAge(input.dateOfBirth, now)) {
      throw new AppError("You must be 18 or older to use ChaufX.", 400, "CUSTOMER_MINIMUM_AGE_REQUIRED");
    }

    if (input.phone) {
      await prisma.user.update({
        where: { id: request.auth!.userId },
        data: { phone: input.phone }
      });
    }

    const customer = await prisma.customerProfile.upsert({
      where: { userId: request.auth!.userId },
      create: {
        userId: request.auth!.userId,
        savedAddresses: [],
        dateOfBirth: input.dateOfBirth,
        primaryAddress: input.primaryAddress,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactEmail: input.emergencyContactEmail,
        vehicleRegistrationProvince: input.vehicle?.registrationProvince,
        vehicleComplianceConfirmedAt: input.vehicleComplianceConfirmed === true ? now : undefined,
        termsAcceptedAt: input.termsAccepted === true ? now : undefined,
        privacyPolicyAcceptedAt: input.privacyPolicyAccepted === true ? now : undefined,
        identityVerificationConsentedAt: input.identityVerificationConsented === true ? now : undefined,
        vehicleAuthorityConfirmedAt: input.vehicleAuthorityConfirmed === true ? now : undefined
      },
      update: {
        dateOfBirth: input.dateOfBirth,
        primaryAddress: input.primaryAddress,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactEmail: input.emergencyContactEmail,
        vehicleRegistrationProvince: input.vehicle?.registrationProvince,
        vehicleComplianceConfirmedAt:
          input.vehicleComplianceConfirmed === undefined ? undefined : input.vehicleComplianceConfirmed ? now : null,
        termsAcceptedAt: input.termsAccepted === undefined ? undefined : input.termsAccepted ? now : null,
        privacyPolicyAcceptedAt: input.privacyPolicyAccepted === undefined ? undefined : input.privacyPolicyAccepted ? now : null,
        identityVerificationConsentedAt:
          input.identityVerificationConsented === undefined ? undefined : input.identityVerificationConsented ? now : null,
        vehicleAuthorityConfirmedAt:
          input.vehicleAuthorityConfirmed === undefined ? undefined : input.vehicleAuthorityConfirmed ? now : null
      }
    });

    if (input.vehicle) {
      const primaryVehicle = await prisma.vehicle.findFirst({
        where: {
          customerId: customer.id,
          isPrimary: true
        }
      });
      const existingVehicle =
        primaryVehicle ??
        (await prisma.vehicle.findFirst({
          where: { customerId: customer.id },
          orderBy: { createdAt: "asc" }
        }));

      if (existingVehicle) {
        await prisma.vehicle.update({
          where: { id: existingVehicle.id },
          data: {
            ...input.vehicle,
            isPrimary: true
          }
        });
      } else {
        await prisma.vehicle.create({
          data: {
            customerId: customer.id,
            ...input.vehicle,
            isPrimary: true
          }
        });
      }
    }

    const storedPhotoId = input.governmentPhotoId
      ? await persistCustomerIdentityDocument({
          customerProfileId: customer.id,
          ...input.governmentPhotoId
        })
      : null;

    const identityDocumentUpdate = storedPhotoId
      ? {
          identityDocument: {
            upsert: {
              create: {
                fileName: input.governmentPhotoId!.fileName,
                fileUrl: storedPhotoId.fileUrl,
                mimeType: storedPhotoId.mimeType
              },
              update: {
                fileName: input.governmentPhotoId!.fileName,
                fileUrl: storedPhotoId.fileUrl,
                mimeType: storedPhotoId.mimeType
              }
            }
          }
        }
      : {};

    const updated = await prisma.customerProfile.update({
      where: { id: customer.id },
      data: identityDocumentUpdate,
      include: {
        vehicles: {
          orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }]
        },
        identityDocument: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            createdAt: true,
            updatedAt: true
          }
        }
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
      make: z.string().trim().min(2).max(80),
      model: z.string().trim().min(1).max(80),
      plateNumber: z.string().trim().min(3).max(24),
      registrationProvince: z.string().trim().min(2).max(80).optional(),
      color: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(500).optional(),
      isPrimary: z.boolean().optional()
    });
    const input = schema.parse(request.body);

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: {
        userId: request.auth!.userId
      }
    });

    const vehicle = await prisma.$transaction(async (tx) => {
      const shouldBePrimary = input.isPrimary ?? (await tx.vehicle.count({ where: { customerId: customer.id } })) === 0;

      if (shouldBePrimary) {
        await tx.vehicle.updateMany({
          where: { customerId: customer.id },
          data: { isPrimary: false }
        });
      }

      return tx.vehicle.create({
        data: {
          customerId: customer.id,
          ...input,
          isPrimary: shouldBePrimary
        }
      });
    });

    response.status(201).json(vehicle);
  })
);

usersRoutes.patch(
  "/users/me/vehicles/:vehicleId",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      make: z.string().trim().min(2).max(80).optional(),
      model: z.string().trim().min(1).max(80).optional(),
      plateNumber: z.string().trim().min(3).max(24).optional(),
      registrationProvince: z.string().trim().min(2).max(80).nullable().optional(),
      color: z.string().trim().max(80).nullable().optional(),
      notes: z.string().trim().max(500).nullable().optional(),
      isPrimary: z.boolean().optional()
    });
    const input = schema.parse(request.body);
    const vehicleId = String(request.params.vehicleId ?? "");
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        customer: { userId: request.auth!.userId }
      }
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found.", 404, "VEHICLE_NOT_FOUND");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const hasPrimaryVehicle = await tx.vehicle.findFirst({
        where: { customerId: vehicle.customerId, isPrimary: true },
        select: { id: true }
      });
      const shouldBePrimary = input.isPrimary === true || !hasPrimaryVehicle;

      if (shouldBePrimary) {
        await tx.vehicle.updateMany({
          where: { customerId: vehicle.customerId, id: { not: vehicle.id } },
          data: { isPrimary: false }
        });
      }

      const { isPrimary, ...vehicleData } = input;
      return tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          ...vehicleData,
          ...(shouldBePrimary ? { isPrimary: true } : {})
        }
      });
    });

    response.json(updated);
  })
);

usersRoutes.delete(
  "/users/me/vehicles/:vehicleId",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const vehicleId = String(request.params.vehicleId ?? "");
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        customer: { userId: request.auth!.userId }
      }
    });

    if (!vehicle) {
      throw new AppError("Vehicle not found.", 404, "VEHICLE_NOT_FOUND");
    }

    await prisma.$transaction(async (tx) => {
      await tx.vehicle.delete({ where: { id: vehicle.id } });

      if (vehicle.isPrimary) {
        const replacement = await tx.vehicle.findFirst({
          where: { customerId: vehicle.customerId },
          orderBy: { updatedAt: "desc" }
        });

        if (replacement) {
          await tx.vehicle.update({
            where: { id: replacement.id },
            data: { isPrimary: true }
          });
        }
      }
    });

    response.status(204).send();
  })
);
