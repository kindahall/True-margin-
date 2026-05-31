<?php
/**
 * Plugin Name: True Margin Tracker for WordPress
 * Plugin URI: https://github.com/artisaul/true-margin-tracker
 * Description: Sync WordPress catalog pages to True Margin Tracker without requiring WooCommerce.
 * Version: 0.1.0
 * Author: Artisaul
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * Text Domain: true-margin-tracker
 *
 * @package TrueMarginTrackerWordPress
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TMTWP_PLUGIN_FILE', __FILE__);
define('TMTWP_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('TMTWP_PLUGIN_URL', plugin_dir_url(__FILE__));
define('TMTWP_VERSION', '0.1.0');

spl_autoload_register(
    static function (string $class): void {
        $prefix = 'TrueMarginTrackerWordPress\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        $path = TMTWP_PLUGIN_DIR . 'src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_readable($path)) {
            require_once $path;
        }
    }
);

register_activation_hook(
    __FILE__,
    static function (): void {
        if (!wp_next_scheduled('tmtwp_sync_retry')) {
            wp_schedule_event(time() + 300, 'hourly', 'tmtwp_sync_retry');
        }
    }
);

register_deactivation_hook(
    __FILE__,
    static function (): void {
        wp_clear_scheduled_hook('tmtwp_sync_retry');
    }
);

add_action(
    'plugins_loaded',
    static function (): void {
        TrueMarginTrackerWordPress\Plugin::boot();
    }
);
