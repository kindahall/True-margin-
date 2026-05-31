<?php

declare(strict_types=1);

namespace TrueMarginTrackerWordPress\Sync;

use TrueMarginTrackerWordPress\Admin\SettingsPage;
use TrueMarginTrackerWordPress\Api\Client;

final class CatalogSync
{
    public function syncSavedPost(int $postId, \WP_Post $post): void
    {
        if (!$this->shouldSync($postId, $post)) {
            return;
        }

        $options = get_option(SettingsPage::OPTION_KEY, []);
        (new Client())->post('/webhooks/wordpress', [
            'event' => 'catalog_product_saved',
            'mode' => 'catalog',
            'siteUrl' => home_url(),
            'productId' => $postId,
            'postType' => $post->post_type,
            'title' => get_the_title($postId),
            'url' => get_permalink($postId),
            'sku' => get_post_meta($postId, '_tmtwp_sku', true),
            'price' => get_post_meta($postId, '_tmtwp_price', true),
            'cogs' => get_post_meta($postId, '_tmtwp_cogs', true),
            'packagingCost' => get_post_meta($postId, '_tmtwp_packaging_cost', true),
            'averageReturnCost' => get_post_meta($postId, '_tmtwp_average_return_cost', true),
            'currency' => (string) ($options['currency'] ?? 'USD'),
            'woocommerceActive' => class_exists('WooCommerce'),
        ]);
    }

    public function retryFailedSyncs(): void
    {
        // Reserved for a persisted retry queue.
    }

    private function shouldSync(int $postId, \WP_Post $post): bool
    {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return false;
        }
        if (wp_is_post_revision($postId) || $post->post_status !== 'publish') {
            return false;
        }
        return (string) get_post_meta($postId, '_tmtwp_catalog_enabled', true) === 'yes';
    }
}
