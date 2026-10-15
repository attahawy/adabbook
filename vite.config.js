import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dataDirectory = fileURLToPath(new URL("./data", import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/adabbook/" : "/",
  plugins: [
    react(),
    {
      name: "local-book-data",
      closeBundle() {
        if (existsSync(dataDirectory))
          cpSync(dataDirectory, "dist/data", { recursive: true });
      },
    },
  ],
  server: { allowedHosts: ["adabbook.localhost"] },
});
