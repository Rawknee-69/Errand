import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const gateway = "http://127.0.0.1:8787";
const proxy = {
  "/api": gateway,
  "/health": gateway,
  "/mcp": gateway,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
});
