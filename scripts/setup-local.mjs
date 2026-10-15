import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const httpd = "/opt/homebrew/opt/httpd/bin/httpd";
const configPath = "/opt/homebrew/etc/httpd/httpd.conf";
const include = `IncludeOptional "${root}dev/apache/adabbook.conf"`;
await access(`${root}dist/index.html`);
await mkdir(`${root}.cache`, { recursive: true });
const original = await readFile(configPath, "utf8");
if (!original.includes(include)) {
  await copyFile(configPath, `${root}.cache/httpd.conf.${Date.now()}.backup`);
  await writeFile(
    configPath,
    `${original.trimEnd()}\n\n# Local Adabbook reader\n${include}\n`,
  );
  try {
    execFileSync(httpd, ["-t"], { stdio: "inherit" });
  } catch (error) {
    await writeFile(configPath, original);
    throw error;
  }
}
execFileSync(httpd, ["-t"], { stdio: "inherit" });
execFileSync(httpd, ["-k", "graceful"], { stdio: "inherit" });
console.log("Reader available at http://adabbook.localhost.");
