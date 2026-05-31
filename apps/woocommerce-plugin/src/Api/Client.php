<?php

declare(strict_types=1);

namespace TrueMarginTracker\Api;

use TrueMarginTracker\Admin\SettingsPage;
use TrueMarginTracker\Security\Signer;

final class Client
{
    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    public function post(string $path, array $payload): array
    {
        $options = get_option(SettingsPage::OPTION_KEY, []);
        $apiUrl = rtrim((string) ($options['api_url'] ?? ''), '/');
        $token = (string) ($options['connection_token'] ?? '');
        $secret = (string) ($options['signing_secret'] ?? '');

        if ($apiUrl === '' || $token === '') {
            return ['ok' => false, 'error' => 'Connection is not configured'];
        }

        $body = wp_json_encode($payload);
        $headers = [
            'Content-Type' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ];

        if ($secret !== '' && is_string($body)) {
            $headers['X-TMT-Signature'] = (new Signer())->sign($body, $secret);
        }

        $response = wp_remote_post($apiUrl . $path, [
            'timeout' => 8,
            'headers' => $headers,
            'body' => $body,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => $response->get_error_message()];
        }

        return [
            'ok' => wp_remote_retrieve_response_code($response) < 400,
            'status' => wp_remote_retrieve_response_code($response),
            'body' => json_decode(wp_remote_retrieve_body($response), true),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public function testConnection(): array
    {
        return $this->post('/stores/connect/woocommerce', [
            'siteUrl' => home_url(),
            'name' => get_bloginfo('name'),
            'pluginVersion' => TMT_VERSION,
        ]);
    }
}
