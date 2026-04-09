# DriveMe MVP

DriveMe is a multi-app chauffeur booking platform for vehicle owners, approved drivers, and platform admins. This monorepo reuses the clean visual feel of the RentSure starter while shifting the product into a production-oriented mobility MVP.

## Architecture Summary

- `apps/api`: Express + TypeScript + Prisma API with JWT auth, RBAC, booking lifecycle rules, driver onboarding, payments placeholders, notifications, and Socket.IO location updates.
- `apps/web`: Next.js public website plus admin dashboard routes, driver onboarding, driver login, and application tracking.
- `apps/customer-mobile`: Expo app for customers to create bookings, review trip history, and access trip tracking only during the active window.
- `apps/driver-mobile`: Expo app for approved drivers to manage availability, accept trips, and share live location during active trips.
- `packages/design-tokens`: Shared DriveMe visual tokens inspired by the original RentSure blue-led identity.
- `packages/config`: Shared business constants including the trip activation window logic.
- `packages/types`: Shared domain types and status enums.
- `packages/ui`: Shared branding helpers and formatting utilities.

## Core Product Rules

- Customers request a personal driver for their own vehicle.
- Drivers must be approved by an admin before they can use the driver mobile app.
- A driver cannot accept overlapping bookings.
- Maps and live tracking only activate after acceptance and only during the configured trip window.
- Customers can cancel only before the trip starts.
- Admins can override assignments and booking statuses when required.

## Local Setup

1. Install dependencies from the repository root:

```bash
npm install
```

2. Copy the environment templates:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/customer-mobile/.env.example apps/customer-mobile/.env
cp apps/driver-mobile/.env.example apps/driver-mobile/.env
```

3. Start PostgreSQL and update `apps/api/.env` with your database connection string.

4. Generate Prisma client, run migrations, and seed demo data:

```bash
npm run prisma:generate -w @driveme/api
npm run prisma:migrate -w @driveme/api
npm run seed -w @driveme/api
```

5. Run the apps you need:

```bash
npm run dev:api
npm run dev:web
npm run dev:customer-mobile
npm run dev:driver-mobile
```

## Demo Accounts

- Admin: `admin@driveme.com` / `NewPass123$`
- Customer: `owner@driveme.app` / `OwnerPass123$`
- Driver: `driver@driveme.app` / `DriverPass123$`

## Delivery Checklist

- Full monorepo structure
- Prisma schema and seed data
- Express API modules for auth, users, drivers, onboarding, bookings, trips, locations, payments, notifications, and admin
- Next.js admin dashboard
- Next.js driver onboarding portal
- Expo customer and driver apps
- Shared trip activation window logic
- Tests for booking logic, auth validation, and API health/booking flow
