import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Static SPA. Deploy dist/ with an SPA fallback to index.html (see docs/deployment.md).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router"],
          "base-ui": ["@base-ui/react"],
          query: ["@tanstack/react-query"],
          markdown: ["markdown-it"],
        },
      },
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
})
