import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { global: "globalThis" },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787", "/artifacts": "http://localhost:8787" }, fs: { allow: ["../.."] } },
  build: { target: "es2022" },
});
