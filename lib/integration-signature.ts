import { createPrivateKey, sign } from "node:crypto";

export const integrationHealthPath = "/api/internal/integration-health";

export function healthAuthorization(seedHex: string, timestamp = Date.now(), path = integrationHealthPath) {
  if (!/^[a-f0-9]{64}$/i.test(seedHex) || !Number.isSafeInteger(timestamp)) {
    throw new Error("Invalid integration signing configuration");
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seedHex, "hex"),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(null, Buffer.from(`GET\n${path}\n${timestamp}`), privateKey);
  return `HealthSignature ${timestamp}.${signature.toString("base64url")}`;
}
