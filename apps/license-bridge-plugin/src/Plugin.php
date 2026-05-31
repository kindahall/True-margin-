<?php

declare(strict_types=1);

namespace TrueMarginTrackerLicenseBridge;

use TrueMarginTrackerLicenseBridge\Admin\ProductPlanFields;
use TrueMarginTrackerLicenseBridge\Admin\SettingsPage;
use TrueMarginTrackerLicenseBridge\Checkout\LicenseIssuer;

final class Plugin
{
    public static function boot(): void
    {
        $settings = new SettingsPage();
        $productPlanFields = new ProductPlanFields();
        $licenseIssuer = new LicenseIssuer();

        add_action('admin_menu', [$settings, 'registerMenu']);
        add_action('admin_init', [$settings, 'registerSettings']);
        add_action('admin_enqueue_scripts', [$settings, 'enqueueAssets']);

        add_action('woocommerce_product_options_general_product_data', [$productPlanFields, 'renderFields']);
        add_action('woocommerce_process_product_meta', [$productPlanFields, 'saveFields']);
        add_action('woocommerce_save_product_variation', [$productPlanFields, 'saveVariationFields'], 10, 2);

        add_action('woocommerce_payment_complete', [$licenseIssuer, 'maybeIssueForOrder']);
        add_action('woocommerce_order_status_completed', [$licenseIssuer, 'maybeIssueForOrder']);
        add_action('woocommerce_order_status_processing', [$licenseIssuer, 'maybeIssueForOrder']);
        add_action('woocommerce_order_details_after_order_table', [$licenseIssuer, 'renderCustomerLicense']);
        add_filter('woocommerce_email_order_meta_fields', [$licenseIssuer, 'emailMetaFields'], 10, 3);
    }
}
