import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/AppError.js";

function normalizeDatabaseMismatchMessage(message: string) {
  if (
    message.includes('invalid input value for enum "UserRole": "MARKETING"') ||
    message.includes('invalid input value for enum "UserRole": \'MARKETING\'')
  ) {
    return "This environment is missing the MARKETING role in the database. Apply prisma/manual-blog-schema.sql to this database and try again.";
  }

  return message;
}

export function errorMiddleware(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  const message = normalizeDatabaseMismatchMessage(error instanceof Error ? error.message : "Unexpected error");

  return response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message
    }
  });
}
