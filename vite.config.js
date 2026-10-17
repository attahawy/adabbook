import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bookFile = fileURLToPath(new URL("./data/book.json", import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/adabbook/" : "/",
  plugins: [
    react(),
    {
      name: "local-book-data",
      closeBundle() {
        mkdirSync("dist/data", { recursive: true });
        copyFileSync(bookFile, "dist/data/book.json");
      },
    },
  ],
  server: { allowedHosts: ["adabbook.localhost"] },
});
