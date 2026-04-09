import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@driveme/types";
import { AppError } from "../common/AppError.js";
import { verifyAccessToken } from "../lib/auth.js";

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
  }

  const token = header.replace("Bearer ", "");

  try {
    const payload = verifyAccessToken(token);
    request.auth = {
      userId: payload.userId,
      role: payload.role as UserRole
    };
    return next();
  } catch {
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
