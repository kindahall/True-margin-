<?php
/**
 * Plugin Name: True Margin Tracker
 * Plugin URI: https://github.com/artisaul/true-margin-tracker
 * Description: Connect WooCommerce to True Margin Tracker and sync product costs, orders, refunds, and return assumptions.
 * Version: 0.1.0
 * Author: Artisaul
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * WC requires at least: 8.0
 * Text Domain: true-margin-tracker
 *
 * @package TrueMarginTracker
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TMT_PLUGIN_FILE', __FILE__);
define('TMT_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('TMT_PLUGIN_URL', plugin_dir_url(__FILE__));
define('TMT_VERSION', '0.1.0');

spl_autoload_register(
    static function (string $class): void {
        $prefix = 'TrueMarginTracker\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        $path = TMT_PLUGIN_DIR . 'src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_readable($path)) {
            require_once $path;
        }
    }
);

register_activation_hook(
    __FILE__,
    static function (): void {
        if (!wp_next_scheduled('tmt_sync_retry')) {
            wp_schedule_event(time() + 300, 'hourly', 'tmt_sync_retry');
        }
    }
);

register_deactivation_hook(
    __FILE__,
    static function (): void {
        wp_clear_scheduled_hook('tmt_sync_retry');
    }
);

add_action(
    'plugins_loaded',
    static function (): void {
        if (!class_exists('WooCommerce')) {
            add_action(
                'admin_notices',
                static function (): void {
                    echo '<div class="notice notice-error"><p>True Margin Tracker requires WooCommerce to be active.</p></div>';
                }
            );
            return;
        }

        TrueMarginTracker\Plugin::boot();
    }
);
