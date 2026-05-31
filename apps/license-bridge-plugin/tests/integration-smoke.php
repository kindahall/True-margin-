<?php

declare(strict_types=1);

define('ABSPATH', __DIR__);
define('TMTLB_VERSION', '0.1.0');

$GLOBALS['tmtlb_last_request'] = null;
$GLOBALS['tmtlb_post_meta'] = [];
$GLOBALS['tmtlb_options'] = [
    'api_url' => 'https://api.example.com/',
    'sales_webhook_secret' => 'sales_secret_123',
    'starter_product_id' => '101',
    'growth_product_id' => '202',
    'pro_product_id' => '303',
];

function assert_true(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function get_option(string $key, mixed $default = null): mixed
{
    return $key === 'tmtlb_options' ? $GLOBALS['tmtlb_options'] : $default;
}

function wp_json_encode(mixed $value, int $flags = 0): string|false
{
    return json_encode($value, $flags);
}

function wp_remote_post(string $url, array $args): array
{
    $GLOBALS['tmtlb_last_request'] = ['url' => $url, 'args' => $args];
    return [
        'response' => ['code' => 200],
        'body' => '{"received":true,"issued":true,"licenseId":"lic_test","licenseKey":"TMT-AAAAAA-BBBBBB-CCCCCC-DDDDDD","plan":"Growth","billingEmail":"buyer@example.com"}',
    ];
}

function is_wp_error(mixed $value): bool
{
    return false;
}

function wp_remote_retrieve_response_code(array $response): int
{
    return (int) ($response['response']['code'] ?? 0);
}

function wp_remote_retrieve_body(array $response): string
{
    return (string) ($response['body'] ?? '');
}

function esc_url_raw(string $value): string
{
    return filter_var($value, FILTER_SANITIZE_URL) ?: '';
}

function sanitize_text_field(string $value): string
{
    return trim(strip_tags($value));
}

function absint(mixed $value): int
{
    return max(0, (int) $value);
}

function get_post_meta(int $postId, string $key, bool $single = false): mixed
{
    return $GLOBALS['tmtlb_post_meta'][$postId][$key] ?? '';
}

function update_post_meta(int $postId, string $key, mixed $value): void
{
    $GLOBALS['tmtlb_post_meta'][$postId][$key] = $value;
}

function delete_post_meta(int $postId, string $key): void
{
    unset($GLOBALS['tmtlb_post_meta'][$postId][$key]);
}

function current_user_can(string $capability, mixed $objectId = null): bool
{
    return true;
}

class WC_Product
{
    public function __construct(private int $id, private int $parentId = 0)
    {
    }

    public function get_id(): int
    {
        return $this->id;
    }

    public function get_parent_id(): int
    {
        return $this->parentId;
    }
}

class WC_Order_Item_Product
{
    public function __construct(private WC_Product $product)
    {
    }

    public function get_product(): WC_Product
    {
        return $this->product;
    }
}

class WC_Order
{
    /** @var array<string,mixed> */
    private array $meta = [];

    /** @var array<int,WC_Order_Item_Product> */
    private array $items;

    /** @var array<int,string> */
    public array $notes = [];

    public function __construct(private int $id, private string $email, private int $customerId, WC_Product $product)
    {
        $this->items = [new WC_Order_Item_Product($product)];
    }

    public function get_id(): int
    {
        return $this->id;
    }

    public function get_customer_id(): int
    {
        return $this->customerId;
    }

    public function get_billing_email(): string
    {
        return $this->email;
    }

    /**
     * @return array<int,WC_Order_Item_Product>
     */
    public function get_items(): array
    {
        return $this->items;
    }

    public function get_meta(string $key): mixed
    {
        return $this->meta[$key] ?? '';
    }

    public function update_meta_data(string $key, mixed $value): void
    {
        $this->meta[$key] = $value;
    }

    public function delete_meta_data(string $key): void
    {
        unset($this->meta[$key]);
    }

    public function save(): void
    {
    }

    public function add_order_note(string $note): void
    {
        $this->notes[] = $note;
    }
}

$GLOBALS['tmtlb_order'] = new WC_Order(5001, 'buyer@example.com', 7001, new WC_Product(202));

function wc_get_order(int $orderId): WC_Order|false
{
    return $orderId === 5001 ? $GLOBALS['tmtlb_order'] : false;
}

require_once __DIR__ . '/../src/Security/Signer.php';
require_once __DIR__ . '/../src/Admin/SettingsPage.php';
require_once __DIR__ . '/../src/Admin/ProductPlanFields.php';
require_once __DIR__ . '/../src/Api/LicenseClient.php';
require_once __DIR__ . '/../src/Checkout/LicenseIssuer.php';

$signer = new TrueMarginTrackerLicenseBridge\Security\Signer();
assert_true(
    $signer->sign('{"plan":"Growth"}', 'sales_secret_123') === hash_hmac('sha256', '{"plan":"Growth"}', 'sales_secret_123'),
    'License bridge signer did not produce the expected HMAC.'
);

$settings = new TrueMarginTrackerLicenseBridge\Admin\SettingsPage();
$clean = $settings->sanitize([
    'api_url' => 'https://api.example.com/root',
    'sales_webhook_secret' => '<b>secret</b>',
    'starter_product_id' => '101',
    'growth_product_id' => 'bad',
    'pro_product_id' => '303',
]);
assert_true($clean['sales_webhook_secret'] === 'secret', 'License bridge settings sanitizer did not strip markup.');
assert_true($clean['growth_product_id'] === '', 'License bridge settings sanitizer did not reject invalid product ID.');

$client = new TrueMarginTrackerLicenseBridge\Api\LicenseClient();
$result = $client->issueLicense([
    'plan' => 'Growth',
    'billingEmail' => 'buyer@example.com',
    'externalOrderId' => 'woocommerce_5001',
    'externalCustomerId' => 'wordpress_7001',
    'provider' => 'woocommerce-owner-site',
]);
$request = $GLOBALS['tmtlb_last_request'];
assert_true($result['ok'] === true, 'License client did not return ok.');
assert_true($request['url'] === 'https://api.example.com/licenses/sales/webhook', 'License client used the wrong API URL.');
assert_true(isset($request['args']['headers']['X-TMT-Signature']), 'License client missed HMAC signature.');
assert_true(
    $request['args']['headers']['X-TMT-Signature'] === hash_hmac('sha256', $request['args']['body'], 'sales_secret_123'),
    'License client signature did not match request body.'
);

$issuer = new TrueMarginTrackerLicenseBridge\Checkout\LicenseIssuer();
$issuer->maybeIssueForOrder(5001);
$order = $GLOBALS['tmtlb_order'];
assert_true($order->get_meta('_tmtlb_license_id') === 'lic_test', 'License issuer did not save license ID.');
assert_true($order->get_meta('_tmtlb_license_key') === 'TMT-AAAAAA-BBBBBB-CCCCCC-DDDDDD', 'License issuer did not save license key.');
assert_true($order->get_meta('_tmtlb_license_plan') === 'Growth', 'License issuer did not save license plan.');
assert_true(count($order->notes) === 1, 'License issuer did not write the order note.');

$issuer->maybeIssueForOrder(5001);
assert_true(count($order->notes) === 1, 'License issuer did not keep paid order issuance idempotent.');

echo "License bridge PHP integration smoke passed." . PHP_EOL;
