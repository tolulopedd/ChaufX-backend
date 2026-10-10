import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { dispatchOutstandingPaidBookings } from "./modules/bookings/booking.service.js";
import { releaseExpiredAuthorizedBookings } from "./modules/payments/payments.routes.js";
import { completeExpiredPaidTrips, sendTripExtensionReminders } from "./modules/trips/trip-lifecycle.service.js";
import { retryPendingPushNotifications } from "./lib/notifications.js";

const app = createApp();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const paidBookingDispatchIntervalMs = env.BOOKING_DISPATCH_SWEEP_INTERVAL_SECONDS * 1000;
const tripLifecycleIntervalMs = 60_000;
let dispatchRetryInFlight = false;
let tripLifecycleInFlight = false;

async function retryOutstandingPaidBookings() {
  if (dispatchRetryInFlight) {
    return;
  }

  dispatchRetryInFlight = true;
  try {
    await dispatchOutstandingPaidBookings();
    await releaseExpiredAuthorizedBookings();
    await retryPendingPushNotifications();
  } catch (error) {
    // A retry failure must not take the API offline; the next interval will retry it.
    console.error("Unable to retry outstanding paid bookings", error);
  } finally {
    dispatchRetryInFlight = false;
  }
}

async function processTripLifecycle() {
  if (tripLifecycleInFlight) {
    return;
  }

  tripLifecycleInFlight = true;
  try {
    await sendTripExtensionReminders();
    await completeExpiredPaidTrips();
  } catch (error) {
    console.error("Unable to process paid trip lifecycle", error);
  } finally {
    tripLifecycleInFlight = false;
  }
}

const paidBookingDispatchTimer = setInterval(() => {
  void retryOutstandingPaidBookings();
}, paidBookingDispatchIntervalMs);
paidBookingDispatchTimer.unref();

const tripLifecycleTimer = setInterval(() => {
  void processTripLifecycle();
}, tripLifecycleIntervalMs);
tripLifecycleTimer.unref();

io.on("connection", (socket) => {
  socket.on("trip:subscribe", (bookingId: string) => {
    socket.join(`trip:${bookingId}`);
  });
});

async function boot() {
  await prisma.$connect();

  await retryOutstandingPaidBookings();
  await processTripLifecycle();

  server.listen(env.PORT, env.HOST, () => {
    console.log(`ChaufX API running on http://${env.HOST}:${env.PORT}`);
  });
}

boot().catch((error) => {
  console.error("Failed to boot API", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  clearInterval(paidBookingDispatchTimer);
  clearInterval(tripLifecycleTimer);
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(paidBookingDispatchTimer);
  clearInterval(tripLifecycleTimer);
  await prisma.$disconnect();
  process.exit(0);
});
