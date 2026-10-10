import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
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

export function errorMiddleware(error: unknown, request: Request, response: Response, _next: NextFunction) {
  console.error(
    "request_failure",
    JSON.stringify({
      method: request.method,
      path: request.path,
      userId: request.auth?.userId ?? null,
      code: error instanceof AppError ? error.code : "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error"
    })
  );
  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join(".");
    const message =
      field === "password" && issue?.code === "too_small"
        ? "Password must be at least 8 characters."
        : field === "email"
          ? "Enter a valid email address."
          : "Please check the information entered and try again.";

    return response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message
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
