import { createPublicKey, verify } from "node:crypto";
import { Socket } from "node:net";

import { getBjbQrisRecipientAgencyId } from "@/lib/bank-bjb/qris/availability";
import { getBjbVaRecipientAgencyId } from "@/lib/bank-bjb/va/availability";
import { getBjbVaEnvironment, getCronEnvironment } from "@/lib/env/server";
import { getQrisRuntimeConfiguration } from "@/lib/payment-settings/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 9;

const healthPath = "/api/internal/status-health";
const configurationTimeoutMs = 3_000;
const connectionTimeoutMs = 3_000;
const maximumClockSkewMs = 60_000;
const responseHeaders = { "cache-control": "no-store" };

type Result = {
  key: "simpul-pad-qris" | "simpul-pad-va";
  ok: boolean;
  latencyMs: number | null;
};

function publicKey() {
  const encoded = process.env.SIMPUL_PAD_HEALTH_PUBLIC_KEY?.trim();
  if (!encoded || encoded.length > 1_024) throw new Error("Unavailable");
  const key = createPublicKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "spki",
  });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Unavailable");
  return key;
}

function authorized(request: Request, key: ReturnType<typeof publicKey>) {
  const match = request.headers
    .get("authorization")
    ?.match(/^HealthSignature ([0-9]{1,16})\.([A-Za-z0-9_-]{86})$/);
  if (!match || request.method !== "GET") return false;

  const timestamp = Number(match[1]);
  if (
    !Number.isSafeInteger(timestamp) ||
    String(timestamp) !== match[1] ||
    Math.abs(Date.now() - timestamp) > maximumClockSkewMs
  ) {
    return false;
  }

  const signature = Buffer.from(match[2], "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== match[2]
  ) {
    return false;
  }

  try {
    return verify(
      null,
      Buffer.from(`GET\n${healthPath}\n${timestamp}`),
      key,
      signature,
    );
  } catch {
    return false;
  }
}

async function configurationWithinDeadline<T>(operation: () => Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Unavailable")),
          configurationTimeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function target(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Unavailable");
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

function connect(destination: ReturnType<typeof target>): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const timeout = setTimeout(() => finish(false), connectionTimeoutMs);

    function finish(ok: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(ok);
    }

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    try {
      socket.connect(destination);
    } catch {
      finish(false);
    }
  });
}

async function check(
  key: Result["key"],
  configuration: () => Promise<string[]>,
): Promise<Result> {
  let destinations: ReturnType<typeof target>[];
  try {
    const urls = await configurationWithinDeadline(configuration);
    destinations = [...new Set(urls)].map(target);
    if (destinations.length === 0) throw new Error("Unavailable");
  } catch {
    return { key, ok: false, latencyMs: null };
  }

  const started = Date.now();
  const connections = await Promise.all(destinations.map(connect));
  return {
    key,
    ok: connections.every(Boolean),
    latencyMs: Math.max(0, Date.now() - started),
  };
}

async function qrisTargets() {
  getCronEnvironment();
  if (!getBjbQrisRecipientAgencyId()) throw new Error("Unavailable");
  const configuration = await getQrisRuntimeConfiguration();
  if (!configuration?.enabled) throw new Error("Unavailable");

  return configuration.engine === "legacy"
    ? [configuration.config.generatorUrl, configuration.config.queryUrl]
    : [configuration.config.baseUrl];
}

async function vaTargets() {
  getCronEnvironment();
  if (
    process.env.BJB_VA_WORKER_ENABLED !== "true" ||
    !getBjbVaRecipientAgencyId()
  ) {
    throw new Error("Unavailable");
  }
  return [getBjbVaEnvironment().baseUrl];
}

export async function GET(request: Request) {
  let key: ReturnType<typeof publicKey>;
  try {
    key = publicKey();
  } catch {
    return Response.json(
      { error: "Service unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }

  if (!authorized(request, key)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: responseHeaders },
    );
  }

  const results = await Promise.all([
    check("simpul-pad-qris", qrisTargets),
    check("simpul-pad-va", vaTargets),
  ]);

  return Response.json({ version: 1, results }, { headers: responseHeaders });
}
