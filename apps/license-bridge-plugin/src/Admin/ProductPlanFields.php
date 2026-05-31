<?php

declare(strict_types=1);

namespace TrueMarginTrackerLicenseBridge\Admin;

final class ProductPlanFields
{
    public const META_KEY = '_tmtlb_plan';
    private const NONCE_ACTION = 'tmtlb_save_product_plan';
    private const NONCE_NAME = '_tmtlb_product_plan_nonce';

    /**
     * @return array<string,string>
     */
    public static function plans(): array
    {
        return [
            '' => 'No license',
            'Starter' => 'Starter',
            'Growth' => 'Growth',
            'Pro' => 'Pro',
        ];
    }

    public function renderFields(): void
    {
        wp_nonce_field(self::NONCE_ACTION, self::NONCE_NAME);
        woocommerce_wp_select([
            'id' => self::META_KEY,
            'label' => 'True Margin Tracker plan',
            'options' => self::plans(),
            'desc_tip' => true,
            'description' => 'Issues this plan when the product is paid.',
        ]);
    }

    public function saveFields(int $postId): void
    {
        if (!current_user_can('edit_post', $postId)) {
            return;
        }
        if (!$this->validNonce()) {
            return;
        }

        $value = sanitize_text_field((string) ($_POST[self::META_KEY] ?? ''));
        $this->savePlan($postId, $value);
    }

    public function saveVariationFields(int $variationId, int $loop): void
    {
        if (!current_user_can('edit_post', $variationId)) {
            return;
        }
        if (!$this->validNonce()) {
            return;
        }

        $values = $_POST[self::META_KEY] ?? [];
        $value = is_array($values) ? (string) ($values[$loop] ?? '') : (string) $values;
        $this->savePlan($variationId, sanitize_text_field($value));
    }

    private function savePlan(int $postId, string $plan): void
    {
        if (!array_key_exists($plan, self::plans())) {
            $plan = '';
        }

        if ($plan === '') {
            delete_post_meta($postId, self::META_KEY);
            return;
        }

        update_post_meta($postId, self::META_KEY, $plan);
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
