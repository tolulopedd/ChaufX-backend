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
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_DOCUMENT_PREFIX: z.string().default("driver-documents"),
  AWS_S3_CUSTOMER_DOCUMENT_PREFIX: z.string().default("customer-documents")
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;

  const requiredSecrets = [
    ["JWT_ACCESS_SECRET", value.JWT_ACCESS_SECRET, "chaufx-access-secret"],
    ["JWT_REFRESH_SECRET", value.JWT_REFRESH_SECRET, "chaufx-refresh-secret"],
    ["STRIPE_SECRET_KEY", value.STRIPE_SECRET_KEY, undefined],
    ["STRIPE_WEBHOOK_SECRET", value.STRIPE_WEBHOOK_SECRET, undefined]
  ] as const;

  for (const [key, configuredValue, insecureDefault] of requiredSecrets) {
    if (!configuredValue || configuredValue === insecureDefault) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be securely configured in production`
      });
    }
  }
});

const parsedEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, cleanEnvValue(value)])
);

export const env = schema.parse(parsedEnv);
