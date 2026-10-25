import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const bookFile = fileURLToPath(new URL("./data/book.json", import.meta.url));
const githubPages = process.env.GITHUB_PAGES === "true";
// Apache serves dist locally; checking a Pages build must leave it intact.
const outputDirectory = githubPages ? "dist-pages" : "dist";

export default defineConfig({
  base: "/",
  build: { outDir: outputDirectory },
  plugins: [
    react(),
    {
      name: "local-book-data",
      closeBundle() {
        mkdirSync(join(outputDirectory, "data"), { recursive: true });
        copyFileSync(bookFile, join(outputDirectory, "data/book.json"));
      },
    },
  ],
  server: { allowedHosts: ["adabbook.localhost"] },
});
