import express from "express";
import path from "path";
import fs from "fs";
import sharp from "sharp";

export function registerThumbnailRoute(app: express.Express) {
  app.get("/api/thumbnail", async (req, res) => {
    const imgPath = req.query.img as string;
    const width = parseInt(req.query.w as string) || 300;
    
    if (!imgPath) {
      return res.status(400).send("Image path is required");
    }

    // Security: prevent directory traversal
    if (imgPath.includes("..")) {
      return res.status(403).send("Invalid image path");
    }

    const cleanPath = imgPath.startsWith("/") ? imgPath.slice(1) : imgPath;

    // Try to find the image in common public directories
    const possiblePaths = [
      path.join(process.cwd(), "portal", "public", cleanPath),
      path.join(process.cwd(), "portal", cleanPath),
      path.join(process.cwd(), "public", cleanPath),
      path.join(process.cwd(), cleanPath),
      // Production paths
      path.join(process.cwd(), "dist", "portal", cleanPath),
    ];

    let fullPath = "";
    for (const p of possiblePaths) {
      if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
        fullPath = p;
        break;
      }
    }

    if (!fullPath) {
      return res.status(404).send("Image not found: " + imgPath);
    }

    try {
      const resized = await sharp(fullPath)
        .resize(width)
        .jpeg({ quality: 80 })
        .toBuffer();

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(resized);
    } catch (err) {
      console.error("[Thumbnails] Resize error:", err);
      res.status(500).send("Error processing image");
    }
  });
}
