import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "../shared"),
      "@client": path.resolve(import.meta.dirname, "../client/src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "../dist/portal"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "wouter"],
          "vendor-utils": ["date-fns", "lucide-react", "clsx", "tailwind-merge"],
          "vendor-ui": ["@tanstack/react-query", "@trpc/client", "@trpc/react-query", "sonner", "react-day-picker"],
        },
      },
    },
  },
  server: {
    port: 3001,
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
