import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA is served by the Bun web server (src/infrastructure/web/webServer.ts)
// from this `dist/` folder. Assets are referenced absolutely (`/assets/...`) so
// they resolve regardless of the per-user entry path (`/u/<id>`).
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
