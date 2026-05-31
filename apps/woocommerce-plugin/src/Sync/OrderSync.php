<?php

declare(strict_types=1);

namespace TrueMarginTracker\Sync;

use TrueMarginTracker\Api\Client;

final class OrderSync
{
    public function queueOrderSync(int $orderId): void
    {
        $this->syncOrder($orderId, 'order_updated');
    }

    public function queueRefundSync(int $orderId): void
    {
        $this->syncOrder($orderId, 'order_refunded');
    }

    public function retryFailedSyncs(): void
    {
        // Reserved for persisted retry queue in the SaaS-connected version.
    }

    private function syncOrder(int $orderId, string $event): void
    {
        $order = wc_get_order($orderId);
        if (!$order) {
            return;
        }

        $lines = [];
        foreach ($order->get_items() as $item) {
            $product = $item->get_product();
            $lines[] = [
                'productId' => $product ? $product->get_id() : null,
                'variationId' => $product ? $product->get_parent_id() : null,
                'sku' => $product ? $product->get_sku() : '',
                'name' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'total' => $item->get_total(),
                'tax' => $item->get_total_tax(),
                'cogs' => $product ? get_post_meta($product->get_id(), '_tmt_cogs', true) : null,
            ];
        }

        (new Client())->post('/webhooks/woocommerce', [
            'event' => $event,
            'orderId' => $order->get_id(),
            'currency' => $order->get_currency(),
            'total' => $order->get_total(),
            'shippingTotal' => $order->get_shipping_total(),
            'discountTotal' => $order->get_discount_total(),
            'lines' => $lines,
        ]);
    }
}
