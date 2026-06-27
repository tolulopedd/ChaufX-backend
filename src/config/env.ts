import "dotenv/config";
import { z } from "zod";

function cleanEnvValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/chaufx"),
  JWT_ACCESS_SECRET: z.string().min(16).default("chaufx-access-secret"),
  JWT_REFRESH_SECRET: z.string().min(16).default("chaufx-refresh-secret"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  CLIENT_APP_URL: z.string().url().default("http://localhost:3000"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("ChaufX <info@chaufx.ca>"),
  STRIPE_SECRET_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_DOCUMENT_PREFIX: z.string().default("driver-documents")
});

const parsedEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, cleanEnvValue(value)])
);

export const env = schema.parse(parsedEnv);
