import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredFiles = [
  "true-margin-tracker-license-bridge.php",
  "readme.txt",
  "uninstall.php",
  "src/Plugin.php",
  "src/Admin/SettingsPage.php",
  "src/Admin/ProductPlanFields.php",
  "src/Api/LicenseClient.php",
  "src/Security/Signer.php",
  "src/Checkout/LicenseIssuer.php",
  "assets/admin.css"
];

const errors = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`Missing ${file}`);
  }
}

const main = fs.readFileSync(path.join(root, "true-margin-tracker-license-bridge.php"), "utf8");
if (!main.includes("Plugin Name: True Margin Tracker License Bridge")) {
  errors.push("Main plugin header is missing");
}
if (!main.includes("register_activation_hook")) {
  errors.push("Activation hook is missing");
}
if (!main.includes("License: GPLv2 or later") || !main.includes("License URI: https://www.gnu.org/licenses/gpl-2.0.html")) {
  errors.push("Main plugin header must use GPLv2 or later for WordPress.org");
}
if (!main.includes("requires WooCommerce to be active")) {
  errors.push("License bridge must clearly require WooCommerce");
}
const headerVersion = main.match(/Version:\s*([^\n]+)/)?.[1]?.trim();

const settings = fs.readFileSync(path.join(root, "src/Admin/SettingsPage.php"), "utf8");
if (!settings.includes("check_admin_referer") || !settings.includes("current_user_can('manage_woocommerce')")) {
  errors.push("Settings page must use nonce and WooCommerce capability checks");
}

const productFields = fs.readFileSync(path.join(root, "src/Admin/ProductPlanFields.php"), "utf8");
if (!productFields.includes("current_user_can('edit_post'") || !productFields.includes("sanitize_text_field")) {
  errors.push("Product plan fields must verify edit capability and sanitize input");
}

const client = fs.readFileSync(path.join(root, "src/Api/LicenseClient.php"), "utf8");
if (!client.includes("/licenses/sales/webhook") || !client.includes("X-TMT-Signature") || !client.includes("wp_remote_post")) {
  errors.push("License client must call the signed sales webhook");
}

const issuer = fs.readFileSync(path.join(root, "src/Checkout/LicenseIssuer.php"), "utf8");
for (const needle of ["woocommerce_payment_complete", "_tmtlb_license_key", "externalOrderId", "woocommerce-owner-site"]) {
  if (!issuer.includes(needle) && !main.includes(needle) && !fs.readFileSync(path.join(root, "src/Plugin.php"), "utf8").includes(needle)) {
    errors.push(`License issuer missing ${needle}`);
  }
}
if (/fake|mock|placeholder/i.test(issuer)) {
  errors.push("License bridge must not include fake or mock order handling.");
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
if (!readme.includes("License: GPLv2 or later") || !readme.includes("== Privacy ==") || !readme.includes("== Security ==")) {
  errors.push("Readme must include GPLv2-or-later license, privacy, and security sections");
}

const allText = requiredFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
if (/[éèêàùç]/i.test(allText)) {
  errors.push("License bridge UI copy must stay in English");
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

console.log("License bridge static checks passed.");
