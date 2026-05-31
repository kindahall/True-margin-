<?php

declare(strict_types=1);

namespace TrueMarginTrackerLicenseBridge\Admin;

final class SettingsPage
{
    public const OPTION_GROUP = 'tmtlb_settings';
    public const OPTION_KEY = 'tmtlb_options';

    public function registerMenu(): void
    {
        add_submenu_page(
            'woocommerce',
            'True Margin Tracker Licenses',
            'TMT Licenses',
            'manage_woocommerce',
            'true-margin-tracker-licenses',
            [$this, 'render']
        );
    }

    public function registerSettings(): void
    {
        register_setting(self::OPTION_GROUP, self::OPTION_KEY, [$this, 'sanitize']);
    }

    public function enqueueAssets(string $hook): void
    {
        if ($hook !== 'woocommerce_page_true-margin-tracker-licenses') {
            return;
        }
        wp_enqueue_style('tmtlb-admin', TMTLB_PLUGIN_URL . 'assets/admin.css', [], TMTLB_VERSION);
    }

    /**
     * @param array<string,mixed> $input
     * @return array<string,string>
     */
    public function sanitize(array $input): array
    {
        return [
            'api_url' => esc_url_raw((string) ($input['api_url'] ?? '')),
            'sales_webhook_secret' => sanitize_text_field((string) ($input['sales_webhook_secret'] ?? '')),
            'starter_product_id' => $this->sanitizeProductId($input['starter_product_id'] ?? ''),
            'growth_product_id' => $this->sanitizeProductId($input['growth_product_id'] ?? ''),
            'pro_product_id' => $this->sanitizeProductId($input['pro_product_id'] ?? ''),
        ];
    }

    private function sanitizeProductId(mixed $value): string
    {
        $id = absint($value);
        return $id > 0 ? (string) $id : '';
    }

    public function render(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('You do not have permission to manage True Margin Tracker licenses.', 'true-margin-tracker-license-bridge'));
        }

        $options = get_option(self::OPTION_KEY, []);
        $apiUrl = (string) ($options['api_url'] ?? '');
        $secret = (string) ($options['sales_webhook_secret'] ?? '');
        $ready = $apiUrl !== '' && $secret !== '';

        if (isset($_POST['tmtlb_save_check']) && check_admin_referer('tmtlb_save_check')) {
            add_settings_error(
                self::OPTION_KEY,
                'tmtlb_saved',
                $ready ? 'License bridge settings are ready.' : 'API URL and sales webhook secret are required.',
                $ready ? 'success' : 'warning'
            );
        }
        ?>
        <div class="wrap tmtlb-admin">
            <h1>True Margin Tracker Licenses</h1>
            <?php settings_errors(self::OPTION_KEY); ?>

            <form method="post" action="options.php" class="tmtlb-grid">
                <?php settings_fields(self::OPTION_GROUP); ?>

                <section class="tmtlb-card">
                    <h2>Connection</h2>
                    <label>
                        API URL
                        <input type="url" name="<?php echo esc_attr(self::OPTION_KEY); ?>[api_url]" value="<?php echo esc_attr($apiUrl); ?>" placeholder="https://api.truemargintracker.com" />
                    </label>
                    <label>
                        Sales webhook secret
                        <input type="password" name="<?php echo esc_attr(self::OPTION_KEY); ?>[sales_webhook_secret]" value="<?php echo esc_attr($secret); ?>" autocomplete="off" />
                    </label>
                </section>

                <section class="tmtlb-card">
                    <h2>Plan Products</h2>
                    <label>
                        Starter product ID
                        <input type="number" min="1" name="<?php echo esc_attr(self::OPTION_KEY); ?>[starter_product_id]" value="<?php echo esc_attr((string) ($options['starter_product_id'] ?? '')); ?>" />
                    </label>
                    <label>
                        Growth product ID
                        <input type="number" min="1" name="<?php echo esc_attr(self::OPTION_KEY); ?>[growth_product_id]" value="<?php echo esc_attr((string) ($options['growth_product_id'] ?? '')); ?>" />
                    </label>
                    <label>
                        Pro product ID
                        <input type="number" min="1" name="<?php echo esc_attr(self::OPTION_KEY); ?>[pro_product_id]" value="<?php echo esc_attr((string) ($options['pro_product_id'] ?? '')); ?>" />
                    </label>
                </section>

                <div class="tmtlb-actions">
                    <?php wp_nonce_field('tmtlb_save_check'); ?>
                    <input type="hidden" name="tmtlb_save_check" value="1" />
                    <?php submit_button('Save License Bridge', 'primary', 'submit', false); ?>
                </div>
            </form>
        </div>
        <?php
    }
}
