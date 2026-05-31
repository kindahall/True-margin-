import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const configs = {
  woocommerce: {
    source: "apps/woocommerce-plugin",
    slug: "true-margin-tracker",
    zipName: "true-margin-tracker-woocommerce.zip"
  },
  wordpress: {
    source: "apps/wordpress-plugin",
    slug: "true-margin-tracker-wordpress",
    zipName: "true-margin-tracker-wordpress.zip"
  },
  "license-bridge": {
    source: "apps/license-bridge-plugin",
    slug: "true-margin-tracker-license-bridge",
    zipName: "true-margin-tracker-license-bridge.zip"
  }
};

const target = process.argv[2];
const config = target ? configs[target] : null;

if (!config) {
  console.error("Usage: node scripts/package-wordpress-plugin.mjs <woocommerce|wordpress|license-bridge>");
  process.exit(1);
}

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = path.resolve(root, config.source);
const packageRoot = path.resolve(root, ".package", config.slug);
const packageParent = path.dirname(packageRoot);
const releaseDir = path.resolve(root, "release");
const dashboardDownloadsDir = path.resolve(root, "apps/dashboard/public/downloads");
const releaseZip = path.join(releaseDir, config.zipName);
const dashboardZip = path.join(dashboardDownloadsDir, config.zipName);

const include = [
  "assets",
  "src",
  "readme.txt",
  "uninstall.php"
];

if (target === "woocommerce") {
  include.push("true-margin-tracker.php");
} else if (target === "license-bridge") {
  include.push("true-margin-tracker-license-bridge.php");
} else {
  include.push("true-margin-tracker-wordpress.php");
}

await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

for (const item of include) {
  await cp(path.join(sourceDir, item), path.join(packageRoot, item), {
    recursive: true,
    force: true,
    preserveTimestamps: true
  });
}

await mkdir(releaseDir, { recursive: true });
await mkdir(dashboardDownloadsDir, { recursive: true });
await rm(releaseZip, { force: true });
await rm(dashboardZip, { force: true });

const zipResult = spawnSync("zip", ["-X", "-r", releaseZip, config.slug], {
  cwd: packageParent,
  encoding: "utf8"
});

if (zipResult.status !== 0) {
  console.error(zipResult.stderr || zipResult.stdout);
  process.exit(zipResult.status ?? 1);
}

await cp(releaseZip, dashboardZip, { force: true });

const listResult = spawnSync("unzip", ["-Z1", releaseZip], {
  encoding: "utf8"
});

if (listResult.status !== 0) {
  console.error(listResult.stderr || listResult.stdout);
  process.exit(listResult.status ?? 1);
}

const entries = listResult.stdout.split(/\r?\n/).filter(Boolean);
const invalidEntry = entries.find((entry) => !entry.startsWith(`${config.slug}/`));
if (invalidEntry) {
  console.error(`Invalid zip root entry: ${invalidEntry}`);
  process.exit(1);
}

console.log(`Packaged ${config.slug} -> ${path.relative(root, releaseZip)} and ${path.relative(root, dashboardZip)}`);
