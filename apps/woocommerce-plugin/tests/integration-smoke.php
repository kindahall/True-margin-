<?php

declare(strict_types=1);

define('ABSPATH', __DIR__);
define('TMT_VERSION', '0.1.0');

$GLOBALS['tmt_last_request'] = null;

function assert_true(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function get_option(string $key, mixed $default = null): mixed
{
    if ($key === 'tmt_options') {
        return [
            'api_url' => 'https://api.example.com/',
            'connection_token' => 'token_123',
            'signing_secret' => 'secret_123',
        ];
    }
    return $default;
}

function wp_json_encode(mixed $value, int $flags = 0): string|false
{
    return json_encode($value, $flags);
}

function wp_remote_post(string $url, array $args): array
{
    $GLOBALS['tmt_last_request'] = ['url' => $url, 'args' => $args];
    return ['response' => ['code' => 200], 'body' => '{"connected":true}'];
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

function home_url(): string
{
    return 'https://shop.example.com';
}

function get_bloginfo(string $key): string
{
    return $key === 'name' ? 'Smoke Store' : '';
}

function esc_url_raw(string $value): string
{
    return filter_var($value, FILTER_SANITIZE_URL) ?: '';
}

function sanitize_text_field(string $value): string
{
    return trim(strip_tags($value));
}

require_once __DIR__ . '/../src/Security/Signer.php';
require_once __DIR__ . '/../src/Admin/SettingsPage.php';
require_once __DIR__ . '/../src/Api/Client.php';

$signer = new TrueMarginTracker\Security\Signer();
assert_true(
    $signer->sign('{"ok":true}', 'secret_123') === hash_hmac('sha256', '{"ok":true}', 'secret_123'),
    'WooCommerce signer did not produce the expected HMAC.'
);

$settings = new TrueMarginTracker\Admin\SettingsPage();
$clean = $settings->sanitize([
    'api_url' => 'https://api.example.com/path',
    'connection_token' => '<b>token</b>',
    'signing_secret' => ' secret ',
]);
assert_true($clean['connection_token'] === 'token', 'WooCommerce settings sanitizer did not strip markup.');
assert_true($clean['signing_secret'] === 'secret', 'WooCommerce settings sanitizer did not trim secret.');

$client = new TrueMarginTracker\Api\Client();
$result = $client->testConnection();
$request = $GLOBALS['tmt_last_request'];
assert_true($result['ok'] === true, 'WooCommerce test connection did not return ok.');
assert_true($request['url'] === 'https://api.example.com/stores/connect/woocommerce', 'WooCommerce client used the wrong API URL.');
assert_true(($request['args']['headers']['Authorization'] ?? '') === 'Bearer token_123', 'WooCommerce client missed bearer token.');
assert_true(isset($request['args']['headers']['X-TMT-Signature']), 'WooCommerce client missed HMAC signature.');
assert_true(
    $request['args']['headers']['X-TMT-Signature'] === hash_hmac('sha256', $request['args']['body'], 'secret_123'),
    'WooCommerce client signature did not match request body.'
);

echo "WooCommerce PHP integration smoke passed." . PHP_EOL;
