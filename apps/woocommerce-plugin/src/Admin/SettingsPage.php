<?php

declare(strict_types=1);

namespace TrueMarginTracker\Admin;

use TrueMarginTracker\Api\Client;

final class SettingsPage
{
    public const OPTION_GROUP = 'tmt_settings';
    public const OPTION_KEY = 'tmt_options';

    public function registerMenu(): void
    {
        add_submenu_page(
            'woocommerce',
            'True Margin Tracker',
            'True Margin Tracker',
            'manage_woocommerce',
            'true-margin-tracker',
            [$this, 'render']
        );
    }

    public function registerSettings(): void
    {
        register_setting(self::OPTION_GROUP, self::OPTION_KEY, [$this, 'sanitize']);
    }

    public function enqueueAssets(string $hook): void
    {
        if ($hook !== 'woocommerce_page_true-margin-tracker') {
            return;
        }
        wp_enqueue_style('tmt-admin', TMT_PLUGIN_URL . 'assets/admin.css', [], TMT_VERSION);
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
        ];
    }

    public function render(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('You do not have permission to manage True Margin Tracker.', 'true-margin-tracker'));
        }

        $options = get_option(self::OPTION_KEY, []);
        $apiUrl = (string) ($options['api_url'] ?? '');
        $token = (string) ($options['connection_token'] ?? '');
        $isConnected = $apiUrl !== '' && $token !== '';
        $client = new Client();
        $testResult = null;

        if (isset($_POST['tmt_test_connection']) && check_admin_referer('tmt_test_connection')) {
            $testResult = $client->testConnection();
        }
        ?>
        <div class="wrap tmt-admin">
            <h1>True Margin Tracker</h1>

            <div class="tmt-grid">
                <section class="tmt-card">
                    <h2>Connection</h2>
                    <p class="<?php echo $isConnected ? 'tmt-status-ok' : 'tmt-status-warning'; ?>">
                        <?php echo $isConnected ? 'Connected settings saved' : 'Connection settings required'; ?>
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
                        <?php submit_button('Save Connection'); ?>
                    </form>
                </section>

                <section class="tmt-card">
                    <h2>Sync Health</h2>
                    <p class="<?php echo $isConnected ? 'tmt-status-ok' : 'tmt-status-warning'; ?>">
                        <?php echo $isConnected ? 'Ready to sync' : 'Connection required'; ?>
                    </p>
                    <form method="post">
                        <?php wp_nonce_field('tmt_test_connection'); ?>
                        <button class="button button-secondary" name="tmt_test_connection" value="1">Test Connection</button>
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
