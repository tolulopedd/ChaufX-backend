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

## Local commands

```bash
npm run dev -w @chaufx/api
npm run prisma:generate -w @chaufx/api
npm run prisma:migrate -w @chaufx/api
npm run seed -w @chaufx/api
```

## Required environment

- `CLIENT_APP_URL`: public web app base URL used for verification, reset-password, and post-payment landing pages
- `API_PUBLIC_URL`: public backend base URL used for payment provider callbacks
