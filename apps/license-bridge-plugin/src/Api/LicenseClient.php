<?php

declare(strict_types=1);

namespace TrueMarginTrackerLicenseBridge\Api;

use TrueMarginTrackerLicenseBridge\Admin\SettingsPage;
use TrueMarginTrackerLicenseBridge\Security\Signer;

final class LicenseClient
{
    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    public function issueLicense(array $payload): array
    {
        $options = get_option(SettingsPage::OPTION_KEY, []);
        $apiUrl = rtrim((string) ($options['api_url'] ?? ''), '/');
        $secret = (string) ($options['sales_webhook_secret'] ?? '');

        if ($apiUrl === '' || $secret === '') {
            return ['ok' => false, 'error' => 'License bridge is not configured'];
        }

        $body = wp_json_encode($payload);
        if (!is_string($body)) {
            return ['ok' => false, 'error' => 'License payload could not be encoded'];
        }

        $response = wp_remote_post($apiUrl . '/licenses/sales/webhook', [
            'timeout' => 12,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-TMT-Signature' => (new Signer())->sign($body, $secret),
            ],
            'body' => $body,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => $response->get_error_message()];
        }

        $status = wp_remote_retrieve_response_code($response);
        $decoded = json_decode(wp_remote_retrieve_body($response), true);
        $bodyData = is_array($decoded) ? $decoded : [];

        return [
            'ok' => $status < 400,
            'status' => $status,
            'body' => $bodyData,
            'error' => (string) ($bodyData['error'] ?? ''),
        ];
    }
}
