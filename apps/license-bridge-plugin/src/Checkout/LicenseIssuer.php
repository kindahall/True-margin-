<?php

declare(strict_types=1);

namespace TrueMarginTrackerLicenseBridge\Checkout;

use TrueMarginTrackerLicenseBridge\Admin\ProductPlanFields;
use TrueMarginTrackerLicenseBridge\Admin\SettingsPage;
use TrueMarginTrackerLicenseBridge\Api\LicenseClient;

final class LicenseIssuer
{
    public const META_LICENSE_ID = '_tmtlb_license_id';
    public const META_LICENSE_KEY = '_tmtlb_license_key';
    public const META_LICENSE_PLAN = '_tmtlb_license_plan';
    public const META_LAST_ERROR = '_tmtlb_last_error';

    private LicenseClient $client;

    public function __construct(?LicenseClient $client = null)
    {
        $this->client = $client ?? new LicenseClient();
    }

    public function maybeIssueForOrder(int $orderId): void
    {
        $order = wc_get_order($orderId);
        if (!$order instanceof \WC_Order) {
            return;
        }

        if ((string) $order->get_meta(self::META_LICENSE_ID) !== '') {
            return;
        }

        $plan = $this->planForOrder($order);
        if ($plan === null) {
            return;
        }

        $billingEmail = (string) $order->get_billing_email();
        if ($billingEmail === '') {
            $this->recordError($order, 'Billing email is required to issue a license.');
            return;
        }

        $payload = [
            'plan' => $plan,
            'billingEmail' => $billingEmail,
            'externalOrderId' => 'woocommerce_' . $order->get_id(),
            'externalCustomerId' => $order->get_customer_id() > 0 ? 'wordpress_' . $order->get_customer_id() : '',
            'provider' => 'woocommerce-owner-site',
        ];

        if ($payload['externalCustomerId'] === '') {
            unset($payload['externalCustomerId']);
        }

        $result = $this->client->issueLicense($payload);
        if (!($result['ok'] ?? false)) {
            $this->recordError($order, (string) ($result['error'] ?? 'License issuing failed.'));
            return;
        }

        $body = is_array($result['body'] ?? null) ? $result['body'] : [];
        $licenseId = (string) ($body['licenseId'] ?? '');
        $licenseKey = (string) ($body['licenseKey'] ?? '');
        $issuedPlan = (string) ($body['plan'] ?? $plan);

        if ($licenseId === '') {
            $this->recordError($order, 'License response did not include a license ID.');
            return;
        }

        $order->update_meta_data(self::META_LICENSE_ID, $licenseId);
        $order->update_meta_data(self::META_LICENSE_PLAN, $issuedPlan);
        if ($licenseKey !== '') {
            $order->update_meta_data(self::META_LICENSE_KEY, $licenseKey);
        }
        $order->delete_meta_data(self::META_LAST_ERROR);
        $order->save();

        $order->add_order_note($licenseKey !== ''
            ? sprintf('True Margin Tracker license issued: %s', $licenseKey)
            : 'True Margin Tracker license already exists for this order.'
        );
    }

    public function renderCustomerLicense(\WC_Order $order): void
    {
        $licenseKey = (string) $order->get_meta(self::META_LICENSE_KEY);
        if ($licenseKey === '') {
            return;
        }

        $plan = (string) $order->get_meta(self::META_LICENSE_PLAN);
        ?>
        <section class="woocommerce-order-details tmtlb-license">
            <h2>True Margin Tracker License</h2>
            <table class="woocommerce-table shop_table">
                <tbody>
                    <tr>
                        <th>Plan</th>
                        <td><?php echo esc_html($plan); ?></td>
                    </tr>
                    <tr>
                        <th>License key</th>
                        <td><code><?php echo esc_html($licenseKey); ?></code></td>
                    </tr>
                </tbody>
            </table>
        </section>
        <?php
    }

    /**
     * @param array<string,array<string,string>> $fields
     * @return array<string,array<string,string>>
     */
    public function emailMetaFields(array $fields, bool $sentToAdmin, \WC_Order $order): array
    {
        if ($sentToAdmin) {
            return $fields;
        }

        $licenseKey = (string) $order->get_meta(self::META_LICENSE_KEY);
        if ($licenseKey === '') {
            return $fields;
        }

        $fields['tmtlb_license_plan'] = [
            'label' => 'True Margin Tracker plan',
            'value' => (string) $order->get_meta(self::META_LICENSE_PLAN),
        ];
        $fields['tmtlb_license_key'] = [
            'label' => 'True Margin Tracker license key',
            'value' => $licenseKey,
        ];

        return $fields;
    }

    private function recordError(\WC_Order $order, string $message): void
    {
        $order->update_meta_data(self::META_LAST_ERROR, $message);
        $order->save();
        $order->add_order_note('True Margin Tracker license error: ' . $message);
    }

    private function planForOrder(\WC_Order $order): ?string
    {
        foreach ($order->get_items() as $item) {
            if (!is_object($item) || !method_exists($item, 'get_product')) {
                continue;
            }

            $product = $item->get_product();
            if (!is_object($product) || !method_exists($product, 'get_id')) {
                continue;
            }

            $ids = [(int) $product->get_id()];
            if (method_exists($product, 'get_parent_id')) {
                $parentId = (int) $product->get_parent_id();
                if ($parentId > 0) {
                    $ids[] = $parentId;
                }
            }

            foreach ($ids as $id) {
                $metaPlan = sanitize_text_field((string) get_post_meta($id, ProductPlanFields::META_KEY, true));
                if ($this->isPlan($metaPlan)) {
                    return $metaPlan;
                }
            }

            $mappedPlan = $this->planFromMappedProduct($ids);
            if ($mappedPlan !== null) {
                return $mappedPlan;
            }
        }

        return null;
    }

    /**
     * @param array<int,int> $productIds
     */
    private function planFromMappedProduct(array $productIds): ?string
    {
        $options = get_option(SettingsPage::OPTION_KEY, []);
        $map = [
            'Starter' => absint($options['starter_product_id'] ?? 0),
            'Growth' => absint($options['growth_product_id'] ?? 0),
            'Pro' => absint($options['pro_product_id'] ?? 0),
        ];

        foreach ($map as $plan => $productId) {
            if ($productId > 0 && in_array($productId, $productIds, true)) {
                return $plan;
            }
        }

        return null;
    }

    private function isPlan(string $plan): bool
    {
        return in_array($plan, ['Starter', 'Growth', 'Pro'], true);
    }
}
