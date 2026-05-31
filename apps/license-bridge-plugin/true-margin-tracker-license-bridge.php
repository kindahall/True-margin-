<?php
/**
 * Plugin Name: True Margin Tracker License Bridge
 * Plugin URI: https://github.com/artisaul/true-margin-tracker
 * Description: Issues True Margin Tracker licenses from a WooCommerce checkout on the owner website.
 * Version: 0.1.0
 * Author: Artisaul
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * WC requires at least: 8.0
 * Text Domain: true-margin-tracker-license-bridge
 *
 * @package TrueMarginTrackerLicenseBridge
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TMTLB_PLUGIN_FILE', __FILE__);
define('TMTLB_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('TMTLB_PLUGIN_URL', plugin_dir_url(__FILE__));
define('TMTLB_VERSION', '0.1.0');

spl_autoload_register(
    static function (string $class): void {
        $prefix = 'TrueMarginTrackerLicenseBridge\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        $path = TMTLB_PLUGIN_DIR . 'src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_readable($path)) {
            require_once $path;
        }
    }
);

register_activation_hook(
    __FILE__,
    static function (): void {
        add_option('tmtlb_options', [
            'api_url' => '',
            'sales_webhook_secret' => '',
            'starter_product_id' => '',
            'growth_product_id' => '',
            'pro_product_id' => '',
        ]);
    }
);

add_action(
    'plugins_loaded',
    static function (): void {
        if (!class_exists('WooCommerce')) {
            add_action(
                'admin_notices',
                static function (): void {
                    echo '<div class="notice notice-error"><p>True Margin Tracker License Bridge requires WooCommerce to be active.</p></div>';
                }
            );
            return;
        }

        TrueMarginTrackerLicenseBridge\Plugin::boot();
    }
);
