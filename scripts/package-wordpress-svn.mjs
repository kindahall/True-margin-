import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const configs = [
  {
    source: "apps/woocommerce-plugin",
    slug: "true-margin-tracker",
    main: "true-margin-tracker.php",
    include: ["assets", "src", "readme.txt", "uninstall.php", "true-margin-tracker.php"]
  },
  {
    source: "apps/wordpress-plugin",
    slug: "true-margin-tracker-wordpress",
    main: "true-margin-tracker-wordpress.php",
    include: ["assets", "src", "readme.txt", "uninstall.php", "true-margin-tracker-wordpress.php"]
  },
  {
    source: "apps/license-bridge-plugin",
    slug: "true-margin-tracker-license-bridge",
    main: "true-margin-tracker-license-bridge.php",
    include: ["assets", "src", "readme.txt", "uninstall.php", "true-margin-tracker-license-bridge.php"]
  }
];

function stableTag(readme) {
  return readme.match(/^Stable tag:\s*(.+)$/m)?.[1]?.trim() || "0.1.0";
}

for (const config of configs) {
  const sourceDir = path.join(root, config.source);
  const readme = await readFile(path.join(sourceDir, "readme.txt"), "utf8");
  const version = stableTag(readme);
  const svnRoot = path.join(root, "release/wordpress-org", config.slug);
  const trunk = path.join(svnRoot, "trunk");
  const tag = path.join(svnRoot, "tags", version);
  const assets = path.join(svnRoot, "assets");

  await rm(svnRoot, { recursive: true, force: true });
  await mkdir(trunk, { recursive: true });
  await mkdir(tag, { recursive: true });
  await mkdir(assets, { recursive: true });

  for (const item of config.include) {
    await cp(path.join(sourceDir, item), path.join(trunk, item), {
      recursive: true,
      force: true,
      preserveTimestamps: true
    });
    await cp(path.join(sourceDir, item), path.join(tag, item), {
      recursive: true,
      force: true,
      preserveTimestamps: true
    });
  }

  await writeFile(path.join(assets, "README.md"), [
    `# ${config.slug} WordPress.org Assets`,
    "",
    "Place WordPress.org listing assets in this directory after approval.",
    "",
    "Expected files include:",
    "",
    "- `banner-1544x500.png`",
    "- `banner-772x250.png`",
    "- `icon-256x256.png`",
    "- `icon-128x128.png`",
    "- `screenshot-1.png` and any additional screenshots listed in `readme.txt`",
    ""
  ].join("\n"), "utf8");

  console.log(`Prepared WordPress.org SVN layout for ${config.slug} (${version}).`);
}
