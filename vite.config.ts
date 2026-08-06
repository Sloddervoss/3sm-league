import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: [".trycloudflare.com"],
    hmr: {
      overlay: false,
    },
  },
  build: {
    target: "esnext",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules\/(react|react-dom|react-router-dom)\//,
            },
            {
              name: "data-vendor",
              test: /node_modules\/(@tanstack|@supabase)\//,
            },
            {
              name: "ui-vendor",
              test: /node_modules\/(@radix-ui|lucide-react|sonner|cmdk|vaul)\//,
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    // Non-render-blocking CSS: ~950ms besparing op mobiel
    {
      name: "non-blocking-css",
      transformIndexHtml(html: string): string {
        return html.replace(
          /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/g,
          (_: string, href: string) =>
            `<link rel="preload" as="style" href="${href}" onload="this.onload=null;this.rel='stylesheet'">\n    <link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">\n    <noscript><link rel="stylesheet" href="${href}"></noscript>`,
        );
      },
    } satisfies Plugin,
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
