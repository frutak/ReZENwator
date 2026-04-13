import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// =============================================================================
// Analytics Plugin - Vite Plugin
// Conditionally injects the analytics script if VITE_ANALYTICS_ENDPOINT
// and VITE_ANALYTICS_WEBSITE_ID are defined in the environment.
// =============================================================================

function vitePluginAnalytics(env: Record<string, string>): Plugin {
  return {
    name: "vite-plugin-analytics",
    transformIndexHtml(html) {
      const endpoint = env.VITE_ANALYTICS_ENDPOINT;
      const websiteId = env.VITE_ANALYTICS_WEBSITE_ID;

      if (!endpoint || !websiteId) {
        return html;
      }

      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              defer: true,
              src: `${endpoint}/umami`,
              "data-website-id": websiteId,
            },
            injectTo: "body",
          },
        ],
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname));

  const plugins = [
    react(),
    tailwindcss(),
    jsxLocPlugin(),
    vitePluginAnalytics(env),
  ];

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    envDir: path.resolve(import.meta.dirname),
    root: path.resolve(import.meta.dirname, "client"),
    publicDir: path.resolve(import.meta.dirname, "client", "public"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      host: true,
      allowedHosts: [
        "localhost",
        "127.0.0.1",
      ],
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
