<?php

declare(strict_types=1);

namespace TrueMarginTracker\Sync;

use TrueMarginTracker\Api\Client;

final class ProductSync
{
    public function queueProductSync(int $productId): void
    {
        $product = wc_get_product($productId);
        if (!$product) {
            return;
        }

        (new Client())->post('/webhooks/woocommerce', [
            'event' => 'product_updated',
            'productId' => $product->get_id(),
            'sku' => $product->get_sku(),
            'name' => $product->get_name(),
            'price' => $product->get_price(),
            'cogs' => get_post_meta($product->get_id(), '_tmt_cogs', true),
            'packagingCost' => get_post_meta($product->get_id(), '_tmt_packaging_cost', true),
            'averageReturnCost' => get_post_meta($product->get_id(), '_tmt_average_return_cost', true),
        ]);
    }
}
