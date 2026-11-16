import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { senseLocalBridgePlugin } from "./dev/local-bridge-plugin"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), senseLocalBridgePlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router"],
          "base-ui": ["@base-ui/react"],
          "query": ["@tanstack/react-query"],
          "charts": ["recharts"],
          "supabase": ["@supabase/supabase-js"],
          "icons": ["lucide-react"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
