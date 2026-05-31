import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredFiles = [
  "true-margin-tracker.php",
  "readme.txt",
  "uninstall.php",
  "src/Plugin.php",
  "src/Admin/SettingsPage.php",
  "src/Admin/ProductCostFields.php",
  "src/Api/Client.php",
  "src/Security/Signer.php",
  "src/Sync/OrderSync.php",
  "src/Sync/ProductSync.php",
  "assets/admin.css"
];

const errors = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`Missing ${file}`);
  }
}

const main = fs.readFileSync(path.join(root, "true-margin-tracker.php"), "utf8");
if (!main.includes("Plugin Name: True Margin Tracker")) {
  errors.push("Main plugin header is missing");
}
if (!main.includes("register_activation_hook")) {
  errors.push("Activation hook is missing");
}
if (!main.includes("License: GPLv2 or later") || !main.includes("License URI: https://www.gnu.org/licenses/gpl-2.0.html")) {
  errors.push("Main plugin header must use GPLv2 or later for WordPress.org");
}
const headerVersion = main.match(/Version:\s*([^\n]+)/)?.[1]?.trim();

const settings = fs.readFileSync(path.join(root, "src/Admin/SettingsPage.php"), "utf8");
if (!settings.includes("check_admin_referer") || !settings.includes("current_user_can('manage_woocommerce')")) {
  errors.push("Settings page must use nonce and WooCommerce capability checks");
}

const productFields = fs.readFileSync(path.join(root, "src/Admin/ProductCostFields.php"), "utf8");
if (!productFields.includes("current_user_can('edit_post'") || !productFields.includes("sanitize_text_field")) {
  errors.push("Product cost fields must verify edit capability and sanitize input");
}

const client = fs.readFileSync(path.join(root, "src/Api/Client.php"), "utf8");
if (!client.includes("X-TMT-Signature") || !client.includes("wp_remote_post")) {
  errors.push("API client must sign and send payloads");
}

const readme = fs.readFileSync(path.join(root, "readme.txt"), "utf8");
for (const field of ["Contributors:", "Tags:", "Requires at least:", "Tested up to:", "Requires PHP:", "Stable tag:", "License:", "License URI:"]) {
  if (!readme.includes(field)) {
    errors.push(`Readme missing ${field}`);
  }
}
const stableTag = readme.match(/Stable tag:\s*([^\n]+)/)?.[1]?.trim();
if (headerVersion && stableTag && headerVersion !== stableTag) {
  errors.push("Main plugin version must match readme stable tag");
}
if (!readme.includes("License: GPLv2 or later") || !readme.includes("== Privacy ==")) {
  errors.push("Readme must include GPLv2-or-later license and privacy section");
}

const allText = requiredFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
if (/[éèêàùç]/i.test(allText)) {
  errors.push("WooCommerce plugin UI copy must stay in English");
}

const phpCheck = spawnSync("node", ["../../scripts/check-plugin-php.mjs", root], {
  cwd: root,
  encoding: "utf8"
});
if (phpCheck.status !== 0) {
  errors.push(phpCheck.stderr || phpCheck.stdout || "PHP syntax check failed");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("WooCommerce plugin static checks passed.");
