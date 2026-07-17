import "dotenv/config";
import express from "express";
import { startScheduler, stopScheduler } from "../workers/scheduler";
import { validateEnv } from "./env";
import { closeDb } from "../db";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerThumbnailRoute } from "./thumbnails";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { BookingRepository } from "../repositories/BookingRepository";
import { generateIcalString } from "./ics";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  app.set("trust proxy", true);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Thumbnail generation
  registerThumbnailRoute(app);

  // iCal Export Route
  app.get("/api/export/:property.ics", async (req, res) => {
    const propertyParam = req.params.property;
    const property = propertyParam === "sadoles" ? "Sadoles" : "Hacjenda";
    
    const activeBookings = await BookingRepository.getBookingsForExport(property as any);

    const ics = generateIcalString(property, activeBookings);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${propertyParam}.ics"`);
    res.send(ics);
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Start background polling jobs
  startScheduler();

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // systemd sends SIGTERM on `systemctl restart`. Stop new polls, drain the
  // HTTP server, and close the DB pool so an in-flight transaction isn't cut
  // mid-write. Guarded so a second signal can't run teardown twice.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);
    stopScheduler();
    server.close(() => console.log("[Shutdown] HTTP server closed."));
    try {
      await closeDb();
      console.log("[Shutdown] Database pool closed.");
    } catch (err) {
      console.error("[Shutdown] Error closing database pool:", err);
    }
    // Give the server a moment to finish draining, then exit.
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Fail fast on missing/invalid configuration before doing any work.
validateEnv();

// A stray rejection or throw in a background cron used to kill the process with
// no context (or silently stop the scheduler). Log them loudly instead.
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err);
});

startServer().catch((err) => {
  console.error("[Startup] Fatal error during startup:", err);
  process.exit(1);
});
