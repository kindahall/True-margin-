import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!root) {
  console.error("Usage: node scripts/check-plugin-php.mjs <plugin-dir>");
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const filePath = path.join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) return walk(filePath);
    return filePath.endsWith(".php") ? [filePath] : [];
  });
}

const php = spawnSync("php", ["-v"], { encoding: "utf8" });
if (php.status !== 0) {
  console.log("PHP CLI not available; skipped PHP syntax check.");
  process.exit(0);
}

const errors = [];
for (const file of walk(root)) {
  const result = spawnSync("php", ["-l", file], { encoding: "utf8" });
  if (result.status !== 0) {
    errors.push(result.stderr || result.stdout || `${file} failed PHP lint`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`PHP syntax checks passed for ${path.basename(root)}.`);
