import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function createAuditLog(input: {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details as Prisma.InputJsonValue | undefined
    }
  });
}
