# WordPress And WooCommerce Submission

Official references:

- WordPress detailed plugin guidelines: https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/
- WordPress SVN release structure: https://developer.wordpress.org/plugins/wordpress-org/how-to-use-subversion/
- WordPress plugin assets: https://developer.wordpress.org/plugins/wordpress-org/plugin-assets/
- WordPress readme standard: https://developer.wordpress.org/plugins/wordpress-org/how-your-readme-txt-works/

## Release Packages

Build both installable plugin zips:

```bash
pnpm release:plugins
```

Outputs:

- `release/true-margin-tracker-woocommerce.zip`
- `release/true-margin-tracker-wordpress.zip`
- `release/plugin-manifest.json`
- `release/wordpress-org/true-margin-tracker/`
- `release/wordpress-org/true-margin-tracker-wordpress/`
- `apps/dashboard/public/downloads/true-margin-tracker-woocommerce.zip`
- `apps/dashboard/public/downloads/true-margin-tracker-wordpress.zip`
- `apps/dashboard/public/downloads/plugin-manifest.json`

Both zips include a single installable root folder. The manifest includes file size, SHA-256 checksum, install root, and entry count for each package.

## Submission Checklist

- Plugin header version matches `readme.txt` stable tag.
- `readme.txt` includes contributors, tags, tested version, PHP requirement, license, and license URI.
- License is GPLv2 or later.
- Readme includes a privacy section for external API communication.
- Admin settings use nonce and capability checks.
- API payloads are signed with HMAC SHA-256 when a signing secret is configured.
- PHP files pass `php -l` when PHP CLI is available.
- Uninstall hooks remove saved options.
- UI copy is English.
- No order data is invented by the WordPress catalog plugin.
- Release manifest checksums match the downloadable ZIPs.

## WordPress.org External Steps

1. Submit the plugin slug through WordPress.org.
2. After approval, check out the SVN repository.
3. Put plugin code in `/trunk`.
4. Put the stable release under `/tags/0.1.0`.
5. Put banners, icons, and screenshots in top-level `/assets`, not inside the plugin ZIP. The generated SVN layouts include an `assets/README.md` with expected filenames.
6. Commit only finished release artifacts.
