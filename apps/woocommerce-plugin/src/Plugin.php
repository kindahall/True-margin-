<?php

declare(strict_types=1);

namespace TrueMarginTracker;

use TrueMarginTracker\Admin\ProductCostFields;
use TrueMarginTracker\Admin\SettingsPage;
use TrueMarginTracker\Sync\OrderSync;
use TrueMarginTracker\Sync\ProductSync;

final class Plugin
{
    public static function boot(): void
    {
        $settings = new SettingsPage();
        $productFields = new ProductCostFields();
        $orderSync = new OrderSync();
        $productSync = new ProductSync();

        add_action('admin_menu', [$settings, 'registerMenu']);
        add_action('admin_init', [$settings, 'registerSettings']);
        add_action('admin_enqueue_scripts', [$settings, 'enqueueAssets']);

        add_action('woocommerce_product_options_pricing', [$productFields, 'renderSimpleFields']);
        add_action('woocommerce_variation_options_pricing', [$productFields, 'renderVariationFields'], 10, 3);
        add_action('woocommerce_process_product_meta', [$productFields, 'saveSimpleFields']);
        add_action('woocommerce_save_product_variation', [$productFields, 'saveVariationFields'], 10, 2);

        add_action('woocommerce_new_order', [$orderSync, 'queueOrderSync']);
        add_action('woocommerce_update_order', [$orderSync, 'queueOrderSync']);
        add_action('woocommerce_order_refunded', [$orderSync, 'queueRefundSync']);
        add_action('woocommerce_update_product', [$productSync, 'queueProductSync']);
        add_action('tmt_sync_retry', [$orderSync, 'retryFailedSyncs']);
    }
}
