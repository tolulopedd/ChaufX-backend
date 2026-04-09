import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/driveme"),
  JWT_ACCESS_SECRET: z.string().min(16).default("driveme-access-secret"),
  JWT_REFRESH_SECRET: z.string().min(16).default("driveme-refresh-secret"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  CLIENT_APP_URL: z.string().url().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("DriveMe <info@drivemecanada.ca>")
});

export const env = schema.parse(process.env);
