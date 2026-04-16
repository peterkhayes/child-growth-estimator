/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Override with BASE env var for GitHub Pages: BASE=/child-growth/ make build
  base: process.env.BASE ?? "/",
  test: {
    environment: "node",
  },
});
