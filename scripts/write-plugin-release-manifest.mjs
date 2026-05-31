import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  {
    platform: "woocommerce",
    name: "True Margin Tracker for WooCommerce",
    slug: "true-margin-tracker",
    zipName: "true-margin-tracker-woocommerce.zip"
  },
  {
    platform: "wordpress",
    name: "True Margin Tracker for WordPress",
    slug: "true-margin-tracker-wordpress",
    zipName: "true-margin-tracker-wordpress.zip"
  },
  {
    platform: "license-bridge",
    name: "True Margin Tracker License Bridge",
    slug: "true-margin-tracker-license-bridge",
    zipName: "true-margin-tracker-license-bridge.zip"
  }
];

async function zipEntries(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Could not inspect ${zipPath}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function packageEntry(config) {
  const releasePath = path.join(root, "release", config.zipName);
  const dashboardPath = path.join(root, "apps/dashboard/public/downloads", config.zipName);
  const [releaseBytes, dashboardBytes, entries] = await Promise.all([
    readFile(releasePath),
    readFile(dashboardPath),
    zipEntries(releasePath)
  ]);

  if (!releaseBytes.equals(dashboardBytes)) {
    throw new Error(`${config.zipName} differs between release/ and dashboard downloads.`);
  }

  const invalidEntry = entries.find((entry) => !entry.startsWith(`${config.slug}/`));
  if (invalidEntry) {
    throw new Error(`${config.zipName} has invalid root entry: ${invalidEntry}`);
  }

  return {
    platform: config.platform,
    name: config.name,
    slug: config.slug,
    file: config.zipName,
    sizeBytes: releaseBytes.byteLength,
    sha256: createHash("sha256").update(releaseBytes).digest("hex"),
    installRoot: config.slug,
    entries: entries.length
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  packages: await Promise.all(packages.map(packageEntry))
};

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
await mkdir(path.join(root, "release"), { recursive: true });
await mkdir(path.join(root, "apps/dashboard/public/downloads"), { recursive: true });
await writeFile(path.join(root, "release/plugin-manifest.json"), manifestText, "utf8");
await writeFile(path.join(root, "apps/dashboard/public/downloads/plugin-manifest.json"), manifestText, "utf8");

console.log("Plugin release manifest written.");
