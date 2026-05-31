<?php

declare(strict_types=1);

namespace TrueMarginTrackerWordPress\Admin;

final class CatalogProductFields
{
    public function registerMetaBoxes(): void
    {
        foreach ($this->supportedPostTypes() as $postType) {
            add_meta_box(
                'tmtwp_catalog_product',
                'True Margin Tracker',
                [$this, 'render'],
                $postType,
                'side',
                'default'
            );
        }
    }

    public function render(\WP_Post $post): void
    {
        wp_nonce_field('tmtwp_save_catalog_fields', 'tmtwp_catalog_nonce');
        $enabled = (string) get_post_meta($post->ID, '_tmtwp_catalog_enabled', true) === 'yes';
        $sku = (string) get_post_meta($post->ID, '_tmtwp_sku', true);
        $price = (string) get_post_meta($post->ID, '_tmtwp_price', true);
        $cogs = (string) get_post_meta($post->ID, '_tmtwp_cogs', true);
        $packaging = (string) get_post_meta($post->ID, '_tmtwp_packaging_cost', true);
        $returns = (string) get_post_meta($post->ID, '_tmtwp_average_return_cost', true);
        ?>
        <div class="tmtwp-metabox">
            <label class="tmtwp-check">
                <input type="checkbox" name="tmtwp_catalog_enabled" value="yes" <?php checked($enabled); ?> />
                Track as product
            </label>
            <label>
                SKU
                <input type="text" name="tmtwp_sku" value="<?php echo esc_attr($sku); ?>" />
            </label>
            <label>
                Price
                <input type="number" step="0.01" min="0" name="tmtwp_price" value="<?php echo esc_attr($price); ?>" />
            </label>
            <label>
                COGS
                <input type="number" step="0.01" min="0" name="tmtwp_cogs" value="<?php echo esc_attr($cogs); ?>" />
            </label>
            <label>
                Packaging
                <input type="number" step="0.01" min="0" name="tmtwp_packaging_cost" value="<?php echo esc_attr($packaging); ?>" />
            </label>
            <label>
                Return cost
                <input type="number" step="0.01" min="0" name="tmtwp_average_return_cost" value="<?php echo esc_attr($returns); ?>" />
            </label>
        </div>
        <?php
    }

    public function saveFields(int $postId, \WP_Post $post): void
    {
        if (!$this->canSave($postId, $post)) {
            return;
        }

        update_post_meta($postId, '_tmtwp_catalog_enabled', isset($_POST['tmtwp_catalog_enabled']) ? 'yes' : 'no');

        foreach ([
            '_tmtwp_sku' => 'tmtwp_sku',
            '_tmtwp_price' => 'tmtwp_price',
            '_tmtwp_cogs' => 'tmtwp_cogs',
            '_tmtwp_packaging_cost' => 'tmtwp_packaging_cost',
            '_tmtwp_average_return_cost' => 'tmtwp_average_return_cost',
        ] as $metaKey => $fieldName) {
            $rawValue = isset($_POST[$fieldName]) ? wp_unslash($_POST[$fieldName]) : '';
            update_post_meta($postId, $metaKey, sanitize_text_field((string) $rawValue));
        }
    }

    /**
     * @return string[]
     */
    private function supportedPostTypes(): array
    {
        $postTypes = get_post_types(['public' => true], 'names');
        return array_values(array_filter($postTypes, static fn (string $postType): bool => !in_array($postType, ['attachment'], true)));
    }

    private function canSave(int $postId, \WP_Post $post): bool
    {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return false;
        }
        if (wp_is_post_revision($postId) || !in_array($post->post_type, $this->supportedPostTypes(), true)) {
            return false;
        }
        if (!isset($_POST['tmtwp_catalog_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['tmtwp_catalog_nonce'])), 'tmtwp_save_catalog_fields')) {
            return false;
        }
        return current_user_can('edit_post', $postId);
    }
}
