import crypto from "node:crypto";

export function timingSafeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function verifyShopifyOAuthHmac(query: Record<string, string | string[] | undefined>, secret: string): boolean {
  const hmac = typeof query.hmac === "string" ? query.hmac : "";
  if (!hmac || !secret) {
    return false;
  }

  const message = Object.entries(query)
    .filter(([key, value]) => key !== "hmac" && key !== "signature" && typeof value === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return timingSafeEqualText(digest, hmac);
}

export function verifyShopifyWebhookHmac(rawBody: string | Buffer, headerHmac: string | undefined, secret: string): boolean {
  if (!headerHmac || !secret) {
    return false;
  }
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return timingSafeEqualText(digest, headerHmac);
}
