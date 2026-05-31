<?php

declare(strict_types=1);

namespace TrueMarginTrackerWordPress;

use TrueMarginTrackerWordPress\Admin\CatalogProductFields;
use TrueMarginTrackerWordPress\Admin\SettingsPage;
use TrueMarginTrackerWordPress\Sync\CatalogSync;

final class Plugin
{
    public static function boot(): void
    {
        $settings = new SettingsPage();
        $catalogFields = new CatalogProductFields();
        $catalogSync = new CatalogSync();

        add_action('admin_menu', [$settings, 'registerMenu']);
        add_action('admin_init', [$settings, 'registerSettings']);
        add_action('admin_enqueue_scripts', [$settings, 'enqueueAssets']);

        add_action('add_meta_boxes', [$catalogFields, 'registerMetaBoxes']);
        add_action('save_post', [$catalogFields, 'saveFields'], 10, 2);
        add_action('save_post', [$catalogSync, 'syncSavedPost'], 30, 2);
        add_action('tmtwp_sync_retry', [$catalogSync, 'retryFailedSyncs']);
    }
}
