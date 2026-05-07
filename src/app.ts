import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { driversRoutes } from "./modules/drivers/drivers.routes.js";
import { driverOnboardingRoutes } from "./modules/driver-onboarding/driver-onboarding.routes.js";
import { bookingsRoutes } from "./modules/bookings/bookings.routes.js";
import { tripsRoutes } from "./modules/trips/trips.routes.js";
import { locationsRoutes } from "./modules/locations/locations.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { notificationsRoutes } from "./modules/notifications/notifications.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { contactMessageRoutes } from "./modules/contact-messages/contact-messages.routes.js";
import { errorMiddleware } from "./middleware/error.js";

export function createApp() {
  const app = express();

  // Render forwards client IPs through X-Forwarded-* headers, so Express
  // needs to trust the first proxy hop for rate limiting and auth logging.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));
  app.use(morgan("dev"));

  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", driverOnboardingRoutes);
  app.use("/api", usersRoutes);
  app.use("/api", driversRoutes);
  app.use("/api", bookingsRoutes);
  app.use("/api", tripsRoutes);
  app.use("/api", locationsRoutes);
  app.use("/api", paymentsRoutes);
  app.use("/api", notificationsRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", contactMessageRoutes);

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found"
      }
    });
  });

  app.use(errorMiddleware);

  return app;
}
