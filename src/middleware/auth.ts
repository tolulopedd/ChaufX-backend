import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../types/shared.js";
import { AppError } from "../common/AppError.js";
import { verifyAccessToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { AccountStatus, UserRole as PrismaUserRole } from "@prisma/client";

export async function requireAuth(request: Request, _response: Response, next: NextFunction) {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
  }

  const token = header.replace("Bearer ", "");

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { role: true, status: true, driver: { select: { approvedAt: true } } }
    });
    if (!user || user.status !== AccountStatus.ACTIVE || user.role.toLowerCase() !== String(payload.role).toLowerCase()) {
      return next(new AppError("This account is no longer active", 401, "ACCOUNT_INACTIVE"));
    }
    if (user.role === PrismaUserRole.DRIVER && !user.driver?.approvedAt) {
      return next(new AppError("Driver access is no longer active", 401, "DRIVER_NOT_APPROVED"));
    }
    request.auth = {
      userId: payload.userId,
      role: String(payload.role).toLowerCase() as UserRole
    };
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError("Invalid token", 401, "INVALID_TOKEN"));
  }
}

export function requireRole(roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.auth) {
      return next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
    }

    if (!roles.includes(request.auth.role)) {
      return next(new AppError("Access denied", 403, "FORBIDDEN"));
    }

    return next();
  };
}
