import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Alleen voor de screenshot-fixtures onder docs/pitwall-look/preview.
 *
 * Geen eigen build, geen eigen invoer in de app: `vite` serveert hier het
 * preview-html met de echte componenten uit `src/`. De normale `npm run dev` en
 * `npm run build` raken dit bestand niet.
 */
export default defineConfig({
  root: path.resolve(__dirname, "."),
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  css: { postcss: path.resolve(__dirname, "postcss.config.js") },
});
