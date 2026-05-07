import type { NextFunction, Request, Response } from "express";

export function asyncHandler<TRequest extends Request = Request>(
  handler: (request: TRequest, response: Response, next: NextFunction) => Promise<unknown>
) {
  return (request: TRequest, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

export function paramValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return typeof value === "string" ? value : "";
}
