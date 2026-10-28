import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

function spa404Fallback(): Plugin {
  return {
    name: "spa-404-fallback",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist")
      const indexPath = path.join(dist, "index.html")
      if (!fs.existsSync(indexPath)) return
      fs.copyFileSync(indexPath, path.join(dist, "404.html"))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), spa404Fallback()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router"],
          "base-ui": ["@base-ui/react"],
          query: ["@tanstack/react-query"],
          supabase: ["@supabase/supabase-js"],
          icons: ["lucide-react"],
        },
      },
    },
  },
})
