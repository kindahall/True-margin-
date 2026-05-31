import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

async function exists(file) {
  try {
    await stat(path.join(root, file));
    return true;
  } catch {
    return false;
  }
}

async function requireFile(file) {
  if (!(await exists(file))) {
    errors.push(`Missing ${file}`);
  }
}

async function read(file) {
  return readFile(path.join(root, file), "utf8");
}

async function verifyManifest() {
  await requireFile("release/plugin-manifest.json");
  await requireFile("apps/dashboard/public/downloads/plugin-manifest.json");
  if (errors.length) return;

  const releaseManifest = await read("release/plugin-manifest.json");
  const dashboardManifest = await read("apps/dashboard/public/downloads/plugin-manifest.json");
  if (releaseManifest !== dashboardManifest) {
    errors.push("Release and dashboard plugin manifests differ.");
  }

  const manifest = JSON.parse(releaseManifest);
  for (const item of manifest.packages ?? []) {
    const releaseZip = `release/${item.file}`;
    const dashboardZip = `apps/dashboard/public/downloads/${item.file}`;
    await requireFile(releaseZip);
    await requireFile(dashboardZip);
    if (!(await exists(releaseZip)) || !(await exists(dashboardZip))) continue;

    const [releaseBytes, dashboardBytes] = await Promise.all([
      readFile(path.join(root, releaseZip)),
      readFile(path.join(root, dashboardZip))
    ]);
    if (!releaseBytes.equals(dashboardBytes)) {
      errors.push(`${item.file} differs between release and dashboard downloads.`);
    }
    const sha256 = createHash("sha256").update(releaseBytes).digest("hex");
    if (sha256 !== item.sha256) {
      errors.push(`${item.file} SHA-256 does not match manifest.`);
    }
    if (releaseBytes.byteLength !== item.sizeBytes) {
      errors.push(`${item.file} size does not match manifest.`);
    }

    const list = spawnSync("unzip", ["-Z1", path.join(root, releaseZip)], { encoding: "utf8" });
    if (list.status !== 0) {
      errors.push(`Could not inspect ${item.file}.`);
      continue;
    }
    const entries = list.stdout.split(/\r?\n/).filter(Boolean);
    if (entries.some((entry) => !entry.startsWith(`${item.installRoot}/`))) {
      errors.push(`${item.file} contains files outside ${item.installRoot}/.`);
    }

    const svnRoot = `release/wordpress-org/${item.slug}`;
    await requireFile(`${svnRoot}/trunk/readme.txt`);
    await requireFile(`${svnRoot}/tags/0.1.0/readme.txt`);
    await requireFile(`${svnRoot}/assets/icon-128x128.png`);
    await requireFile(`${svnRoot}/assets/icon-256x256.png`);
    await requireFile(`${svnRoot}/assets/banner-772x250.png`);
    await requireFile(`${svnRoot}/assets/banner-1544x500.png`);
  }
}

async function walkFiles(dir) {
  const absolute = path.join(root, dir);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function verifyDocsAndCompliance() {
  const requiredDocs = [
    "docs/legal/privacy-policy.md",
    "docs/legal/terms-of-service.md",
    "docs/submission/listing-copy.md",
    "docs/submission/shopify.md",
    "docs/submission/woo-marketplace.md",
    "docs/submission/wordpress-woocommerce.md",
    "docs/owner-site-license-bridge.md",
    "docs/deployment.md"
  ];
  for (const file of requiredDocs) await requireFile(file);

  const filesToScan = [
    "apps/woocommerce-plugin/readme.txt",
    "apps/woocommerce-plugin/true-margin-tracker.php",
    "apps/wordpress-plugin/readme.txt",
    "apps/wordpress-plugin/true-margin-tracker-wordpress.php",
    "apps/license-bridge-plugin/readme.txt",
    "apps/license-bridge-plugin/true-margin-tracker-license-bridge.php",
    "docs/legal/privacy-policy.md",
    "docs/legal/terms-of-service.md"
  ];
  for (const file of filesToScan) {
    const text = await read(file);
    if (/License:\s*MIT|opensource\.org\/licenses\/MIT/i.test(text)) {
      errors.push(`${file} still references MIT licensing.`);
    }
  }

  const wooReadme = await read("apps/woocommerce-plugin/readme.txt");
  const wpReadme = await read("apps/wordpress-plugin/readme.txt");
  const bridgeReadme = await read("apps/license-bridge-plugin/readme.txt");
  for (const [label, text] of [["WooCommerce", wooReadme], ["WordPress", wpReadme], ["License Bridge", bridgeReadme]]) {
    for (const required of ["License: GPLv2 or later", "== Privacy ==", "== Security =="]) {
      if (!text.includes(required)) errors.push(`${label} readme missing ${required}.`);
    }
  }
}

async function verifyMarketplaceAssets() {
  const requiredAssets = [
    "release/marketplace-assets/app-icon-1024.png",
    "release/marketplace-assets/shopify/app-icon-1200.png",
    "release/marketplace-assets/wordpress-org/banner-1544x500.png",
    "release/marketplace-assets/wordpress-org/banner-772x250.png",
    "release/marketplace-assets/wordpress-org/icon-256x256.png",
    "release/marketplace-assets/wordpress-org/icon-128x128.png"
  ];
  for (const file of requiredAssets) await requireFile(file);
  for (const file of requiredAssets) {
    if (!(await exists(file))) continue;
    const bytes = await readFile(path.join(root, file));
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      errors.push(`${file} is not a PNG file.`);
    }
  }
}

async function verifyDeploymentArtifacts() {
  const required = [
    ".dockerignore",
    ".github/workflows/ci.yml",
    "docker-compose.production.yml",
    "apps/api/Dockerfile",
    "apps/dashboard/Dockerfile",
    "apps/dashboard/nginx.conf",
    "apps/shopify-app/Dockerfile",
    "docs/submission/launch-runbook.md"
  ];
  for (const file of required) await requireFile(file);

  const rootPackage = JSON.parse(await read("package.json"));
  for (const script of ["release:plugins", "verify:production", "assets:marketplace"]) {
    if (!rootPackage.scripts?.[script]) errors.push(`package.json missing ${script} script.`);
  }

  for (const file of ["apps/woocommerce-plugin/package.json", "apps/wordpress-plugin/package.json", "apps/license-bridge-plugin/package.json"]) {
    const pkg = JSON.parse(await read(file));
    if (!pkg.scripts?.test?.includes("php tests/integration-smoke.php")) {
      errors.push(`${file} test script must run PHP integration smoke.`);
    }
  }

  const runtimeDataFiles = [
    ...await walkFiles(".data"),
    ...await walkFiles("apps/api/.data"),
    ...await walkFiles("apps/dashboard/.data"),
    ...await walkFiles("apps/shopify-app/.data")
  ];
  if (runtimeDataFiles.length) {
    errors.push(`Runtime .data files should not be present in release state: ${runtimeDataFiles.join(", ")}`);
  }
}

await verifyManifest();
await verifyDocsAndCompliance();
await verifyMarketplaceAssets();
await verifyDeploymentArtifacts();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Production readiness checks passed.");
