<?php

declare(strict_types=1);

namespace TrueMarginTrackerLicenseBridge\Security;

final class Signer
{
    public function sign(string $payload, string $secret): string
    {
        return hash_hmac('sha256', $payload, $secret);
    }
}
