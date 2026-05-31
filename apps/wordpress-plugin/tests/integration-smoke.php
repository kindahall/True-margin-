<?php

declare(strict_types=1);

define('ABSPATH', __DIR__);
define('TMTWP_VERSION', '0.1.0');

$GLOBALS['tmtwp_last_request'] = null;

function assert_true(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function get_option(string $key, mixed $default = null): mixed
{
    if ($key === 'tmtwp_options') {
        return [
            'api_url' => 'https://api.example.com/',
            'connection_token' => 'token_456',
            'signing_secret' => 'secret_456',
            'currency' => 'USD',
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
    $GLOBALS['tmtwp_last_request'] = ['url' => $url, 'args' => $args];
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
    return 'https://catalog.example.com';
}

function get_bloginfo(string $key): string
{
    return $key === 'name' ? 'Catalog Site' : '';
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

$signer = new TrueMarginTrackerWordPress\Security\Signer();
assert_true(
    $signer->sign('{"ok":true}', 'secret_456') === hash_hmac('sha256', '{"ok":true}', 'secret_456'),
    'WordPress signer did not produce the expected HMAC.'
);

$settings = new TrueMarginTrackerWordPress\Admin\SettingsPage();
$clean = $settings->sanitize([
    'api_url' => 'https://api.example.com/path',
    'connection_token' => '<b>token</b>',
    'signing_secret' => ' secret ',
    'currency' => ' eur ',
]);
assert_true($clean['connection_token'] === 'token', 'WordPress settings sanitizer did not strip markup.');
assert_true($clean['signing_secret'] === 'secret', 'WordPress settings sanitizer did not trim secret.');
assert_true($clean['currency'] === 'eur', 'WordPress settings sanitizer did not preserve currency input.');

$client = new TrueMarginTrackerWordPress\Api\Client();
$result = $client->testConnection();
$request = $GLOBALS['tmtwp_last_request'];
assert_true($result['ok'] === true, 'WordPress test connection did not return ok.');
assert_true($request['url'] === 'https://api.example.com/stores/connect/wordpress', 'WordPress client used the wrong API URL.');
assert_true(($request['args']['headers']['Authorization'] ?? '') === 'Bearer token_456', 'WordPress client missed bearer token.');
assert_true(isset($request['args']['headers']['X-TMT-Signature']), 'WordPress client missed HMAC signature.');
assert_true(
    $request['args']['headers']['X-TMT-Signature'] === hash_hmac('sha256', $request['args']['body'], 'secret_456'),
    'WordPress client signature did not match request body.'
);

echo "WordPress PHP integration smoke passed." . PHP_EOL;
