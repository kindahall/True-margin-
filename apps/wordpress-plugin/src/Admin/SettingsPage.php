<?php

declare(strict_types=1);

namespace TrueMarginTrackerWordPress\Admin;

use TrueMarginTrackerWordPress\Api\Client;

final class SettingsPage
{
    public const OPTION_GROUP = 'tmtwp_settings';
    public const OPTION_KEY = 'tmtwp_options';

    public function registerMenu(): void
    {
        add_menu_page(
            'True Margin Tracker',
            'True Margin Tracker',
            'manage_options',
            'true-margin-tracker',
            [$this, 'render'],
            'dashicons-chart-line',
            58
        );
    }

    public function registerSettings(): void
    {
        register_setting(self::OPTION_GROUP, self::OPTION_KEY, [$this, 'sanitize']);
    }

    public function enqueueAssets(string $hook): void
    {
        if ($hook !== 'toplevel_page_true-margin-tracker') {
            return;
        }
        wp_enqueue_style('tmtwp-admin', TMTWP_PLUGIN_URL . 'assets/admin.css', [], TMTWP_VERSION);
    }

    /**
     * @param array<string,mixed> $input
     * @return array<string,string>
     */
    public function sanitize(array $input): array
    {
        return [
            'api_url' => esc_url_raw((string) ($input['api_url'] ?? '')),
            'connection_token' => sanitize_text_field((string) ($input['connection_token'] ?? '')),
            'signing_secret' => sanitize_text_field((string) ($input['signing_secret'] ?? '')),
            'currency' => sanitize_text_field((string) ($input['currency'] ?? 'USD')),
        ];
    }

    public function render(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to manage True Margin Tracker.', 'true-margin-tracker'));
        }

        $options = get_option(self::OPTION_KEY, []);
        $apiUrl = (string) ($options['api_url'] ?? '');
        $token = (string) ($options['connection_token'] ?? '');
        $currency = (string) ($options['currency'] ?? 'USD');
        $isConnected = $apiUrl !== '' && $token !== '';
        $testResult = null;

        if (isset($_POST['tmtwp_test_connection']) && check_admin_referer('tmtwp_test_connection')) {
            $testResult = (new Client())->testConnection();
        }
        ?>
        <div class="wrap tmtwp-admin">
            <h1>True Margin Tracker</h1>

            <div class="tmtwp-grid">
                <section class="tmtwp-card">
                    <h2>Connection</h2>
                    <p class="<?php echo $isConnected ? 'tmtwp-status-ok' : 'tmtwp-status-warning'; ?>">
                        <?php echo $isConnected ? 'Settings saved' : 'Setup required'; ?>
                    </p>
                    <form method="post" action="options.php">
                        <?php settings_fields(self::OPTION_GROUP); ?>
                        <label>
                            API URL
                            <input type="url" name="<?php echo esc_attr(self::OPTION_KEY); ?>[api_url]" value="<?php echo esc_attr($apiUrl); ?>" placeholder="https://api.truemargintracker.com" />
                        </label>
                        <label>
                            Connection token
                            <input type="password" name="<?php echo esc_attr(self::OPTION_KEY); ?>[connection_token]" value="<?php echo esc_attr($token); ?>" autocomplete="off" />
                        </label>
                        <label>
                            Signing secret
                            <input type="password" name="<?php echo esc_attr(self::OPTION_KEY); ?>[signing_secret]" value="<?php echo esc_attr((string) ($options['signing_secret'] ?? '')); ?>" autocomplete="off" />
                        </label>
                        <label>
                            Currency
                            <input type="text" name="<?php echo esc_attr(self::OPTION_KEY); ?>[currency]" value="<?php echo esc_attr($currency); ?>" maxlength="3" />
                        </label>
                        <?php submit_button('Save'); ?>
                    </form>
                </section>

                <section class="tmtwp-card">
                    <h2>Catalog Mode</h2>
                    <div class="tmtwp-facts">
                        <span>WordPress active</span>
                        <strong><?php echo esc_html(get_bloginfo('name')); ?></strong>
                        <span>WooCommerce</span>
                        <strong><?php echo class_exists('WooCommerce') ? 'Detected' : 'Not installed'; ?></strong>
                    </div>
                    <form method="post">
                        <?php wp_nonce_field('tmtwp_test_connection'); ?>
                        <button class="button button-secondary" name="tmtwp_test_connection" value="1">Test Connection</button>
                    </form>
                    <?php if (is_array($testResult)) : ?>
                        <pre><?php echo esc_html(wp_json_encode($testResult, JSON_PRETTY_PRINT)); ?></pre>
                    <?php endif; ?>
                </section>
            </div>
        </div>
        <?php
    }
}
