import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

io.on("connection", (socket) => {
  socket.on("trip:subscribe", (bookingId: string) => {
    socket.join(`trip:${bookingId}`);
  });
});

async function boot() {
  await prisma.$connect();

  server.listen(env.PORT, env.HOST, () => {
    console.log(`ChaufX API running on http://${env.HOST}:${env.PORT}`);
  });
}

boot().catch((error) => {
  console.error("Failed to boot API", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
