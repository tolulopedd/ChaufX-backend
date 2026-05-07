# ChaufX API

Express + Prisma backend for the ChaufX MVP.

## Modules

- Auth
- Users
- Drivers
- Driver onboarding
- Bookings
- Trips
- Locations
- Payments
- Notifications
- Admin

## Environment variables

Copy the example file:

```bash
cp .env.example .env
```

Required core values:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chaufx
JWT_ACCESS_SECRET=chaufx-access-secret
JWT_REFRESH_SECRET=chaufx-refresh-secret
CLIENT_APP_URL=http://localhost:3000
EMAIL_FROM=ChaufX Canada <info@chaufx.ca>
```

Optional integrations:

- `RESEND_API_KEY` for transactional email
- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_DOCUMENT_PREFIX`

## Local development

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run seed
npm run dev
```

## Build

```bash
npm install --include=dev
npx prisma generate
npm run build
```

## Render deployment

Recommended settings:

- Root directory: repository root
- Build command: `npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build`
- Start command: `node dist/src/server.js`

Required Render environment variables:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ACCESS_TOKEN_TTL`
- `REFRESH_TOKEN_TTL_DAYS`
- `CLIENT_APP_URL`
- `EMAIL_FROM`

If you are using email verification:

- `RESEND_API_KEY`

If you are using S3 document storage:

- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_DOCUMENT_PREFIX`

## Notes

- This repo is intentionally backend-only.
- The public/admin website lives in `ChaufX-Web`.
- The customer and driver apps live in `ChaufX-Mobile`.
