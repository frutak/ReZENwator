import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { registerThumbnailRoute } from "./_core/thumbnails";
import { getDb } from "./db";
import { bookings } from "../drizzle/schema";
import { eq, and, ne } from "drizzle-orm";
import { generateIcalString } from "./_core/ics";
import path from "path";
import fs from "fs";

async function startPortalServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Thumbnail generation
  registerThumbnailRoute(app);

  // iCal Export Route
  app.get("/api/export/:property.ics", async (req, res) => {
    const propertyParam = req.params.property;
    const property = propertyParam === "sadoles" ? "Sadoles" : "Hacjenda";
    
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const activeBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.property, property as any),
          ne(bookings.status, "cancelled")
        )
      );

    const ics = generateIcalString(property, activeBookings);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${propertyParam}.ics"`);
    res.send(ics);
  });

  // tRPC API (same router, public procedures)
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // iCal Export Route (duplicate logic or import from main index)
  // For simplicity, I'll add it here too if needed, but it's already in the main server.
  // The guest portal might not need to serve iCals, the main management server handles that.

  const PORT = 3001;

  // Static files for the portal
  const distPath = path.resolve(process.cwd(), "dist/portal");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.log("Portal dist folder not found. Run 'npm run build:portal' first.");
  }

  server.listen(PORT, () => {
    console.log(`Guest Portal running on http://localhost:${PORT}/`);
  });
}

startPortalServer().catch(console.error);
