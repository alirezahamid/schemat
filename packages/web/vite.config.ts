import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The CLI serves the built assets, so use a relative base to keep asset URLs
// working regardless of the mount path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
