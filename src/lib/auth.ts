import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAccessToken(payload: { userId: string; role: string }) {
  const expiresIn = env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"];
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn
  });
}

export function signRefreshToken(payload: { userId: string; role: string }) {
  const expiresIn = `${refreshTokenTtlDays(payload.role)}d` as SignOptions["expiresIn"];
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string; role: string };
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string; role: string };
}

export function refreshTokenTtlDays(role: string) {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "driver") return env.DRIVER_REFRESH_TOKEN_TTL_DAYS;
  if (normalizedRole === "customer") return env.CUSTOMER_REFRESH_TOKEN_TTL_DAYS;
  return env.REFRESH_TOKEN_TTL_DAYS;
}

export function refreshExpiryDate(role = "admin") {
  return new Date(Date.now() + refreshTokenTtlDays(role) * 24 * 60 * 60 * 1000);
}
