<?php

declare(strict_types=1);

namespace TrueMarginTracker\Admin;

final class ProductCostFields
{
    private const NONCE_ACTION = 'tmt_save_product_costs';
    private const NONCE_NAME = '_tmt_product_cost_nonce';

    public function renderSimpleFields(): void
    {
        echo '<div class="options_group">';
        wp_nonce_field(self::NONCE_ACTION, self::NONCE_NAME);
        woocommerce_wp_text_input([
            'id' => '_tmt_cogs',
            'label' => 'Product cost (COGS)',
            'description' => 'Cost used by True Margin Tracker to calculate real margin.',
            'type' => 'number',
            'custom_attributes' => ['step' => '0.01', 'min' => '0'],
        ]);
        woocommerce_wp_text_input([
            'id' => '_tmt_packaging_cost',
            'label' => 'Packaging cost',
            'type' => 'number',
            'custom_attributes' => ['step' => '0.01', 'min' => '0'],
        ]);
        woocommerce_wp_text_input([
            'id' => '_tmt_average_return_cost',
            'label' => 'Average return cost',
            'type' => 'number',
            'custom_attributes' => ['step' => '0.01', 'min' => '0'],
        ]);
        echo '</div>';
    }

    public function renderVariationFields(int $loop, array $variationData, \WP_Post $variation): void
    {
        woocommerce_wp_text_input([
            'id' => "_tmt_cogs_{$loop}",
            'name' => "_tmt_cogs[{$variation->ID}]",
            'label' => 'COGS',
            'value' => get_post_meta($variation->ID, '_tmt_cogs', true),
            'type' => 'number',
            'wrapper_class' => 'form-row form-row-first',
            'custom_attributes' => ['step' => '0.01', 'min' => '0'],
        ]);
        woocommerce_wp_text_input([
            'id' => "_tmt_packaging_cost_{$loop}",
            'name' => "_tmt_packaging_cost[{$variation->ID}]",
            'label' => 'Packaging',
            'value' => get_post_meta($variation->ID, '_tmt_packaging_cost', true),
            'type' => 'number',
            'wrapper_class' => 'form-row form-row-last',
            'custom_attributes' => ['step' => '0.01', 'min' => '0'],
        ]);
    }

    public function saveSimpleFields(int $postId): void
    {
        if (!current_user_can('edit_post', $postId)) {
            return;
        }
        if (!$this->validNonce()) {
            return;
        }

        foreach (['_tmt_cogs', '_tmt_packaging_cost', '_tmt_average_return_cost'] as $key) {
            if (isset($_POST[$key])) {
                $rawValue = sanitize_text_field(wp_unslash($_POST[$key]));
                update_post_meta($postId, $key, wc_format_decimal($rawValue));
            }
        }
    }

    public function saveVariationFields(int $variationId, int $loop): void
    {
        if (!current_user_can('edit_post', $variationId)) {
            return;
        }
        if (!$this->validNonce()) {
            return;
        }

        foreach (['_tmt_cogs', '_tmt_packaging_cost'] as $key) {
            $values = isset($_POST[$key]) && is_array($_POST[$key]) ? wp_unslash($_POST[$key]) : [];
            if (isset($values[$variationId])) {
                $rawValue = sanitize_text_field((string) $values[$variationId]);
                update_post_meta($variationId, $key, wc_format_decimal($rawValue));
            }
        }
    }

    private function validNonce(): bool
    {
        if (!isset($_POST[self::NONCE_NAME])) {
            return false;
        }

        $nonce = sanitize_text_field(wp_unslash((string) $_POST[self::NONCE_NAME]));
        return (bool) wp_verify_nonce($nonce, self::NONCE_ACTION);
    }
}
