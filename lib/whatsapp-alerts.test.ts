import assert from "node:assert/strict";
import test from "node:test";
import { alertBodyValues, buildOcaAlertPayload, parseAlertRecipient, parseAlertRecipients, sendOcaAlert } from "./whatsapp-alerts";

const failures = [
  { serviceKey: "sapada", statusCode: 502 },
  { serviceKey: "sapada-tte", statusCode: null },
];
const checkedAt = new Date("2026-09-30T07:00:00.000Z");
const config = { endpoint: "https://oca.example.test/send", token: "secret", templateCode: "marketing:peringatan_gangguan_layanan_bapenda" };

test("Simpul alerts identify the service for payment names shared with SAPADA", () => {
  const [names, , reasons] = alertBodyValues([
    { serviceKey: "sapada-va-bjb", statusCode: null },
    { serviceKey: "simpul-pad-va", statusCode: null },
    { serviceKey: "simpul-pad-login", statusCode: 503 },
  ], checkedAt);
  assert.equal(names, "Virtual Account BJB, Simpul PAD · Virtual Account BJB, Simpul PAD · Login");
  assert.match(reasons, /Simpul PAD · Virtual Account BJB: tidak dapat diakses/);
  assert.match(reasons, /Simpul PAD · Login: HTTP 503/);
});

test("recipient configuration normalizes Indonesian numbers and removes duplicates", () => {
  assert.deepEqual(parseAlertRecipients("0813-1526-5538, +6281315265538\n628123456789"), ["6281315265538", "628123456789"]);
  assert.throws(() => parseAlertRecipients("6281315265538,not-a-phone"));
});

test("admin recipient input accepts one valid number only", () => {
  assert.equal(parseAlertRecipient("+62813-1526-5538"), "6281315265538");
  assert.equal(parseAlertRecipient("081315265538"), "6281315265538");
  for (const input of ["", "123", "6281315265538,6281234567890", "6281315265538 6281315265538", "wrong"]) {
    assert.equal(parseAlertRecipient(input), null);
  }
});

test("OCA payload follows the three body variables in order", () => {
  assert.deepEqual(alertBodyValues(failures, checkedAt), [
    "SAPADA, TTE", "30 Sep 2026, 14.00", "SAPADA: HTTP 502; TTE: tidak dapat diakses",
  ]);
  const payload = buildOcaAlertPayload("6281315265538", config.templateCode, failures, checkedAt);
  assert.equal(payload.phone_number, "6281315265538");
  assert.equal(payload.message.template.template_code_id, config.templateCode);
  assert.deepEqual(payload.message.template.payload[0].parameters.map((item) => item.text), alertBodyValues(failures, checkedAt));
});

test("OCA acceptance requires a provider message id", async () => {
  let requestBody: unknown;
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ success: true, msgid: "oca-message-1" });
  }) as typeof fetch;
  const result = await sendOcaAlert({ phone: "6281315265538", failures, checkedAt }, config, request);
  assert.deepEqual(result, { status: "accepted", messageId: "oca-message-1" });
  assert.equal((requestBody as { message: { type: string } }).message.type, "template");
});

test("uncertain OCA outcomes are held for review instead of resent", async () => {
  const request = (async () => new Response("", { status: 503 })) as typeof fetch;
  assert.equal((await sendOcaAlert({ phone: "6281315265538", failures, checkedAt }, config, request)).status, "needs_review");
  const invalid = (async () => Response.json({ success: true })) as typeof fetch;
  assert.equal((await sendOcaAlert({ phone: "6281315265538", failures, checkedAt }, config, invalid)).status, "needs_review");
});

test("a rate limit can retry after a delay", async () => {
  const request = (async () => new Response("", { status: 429 })) as typeof fetch;
  assert.equal((await sendOcaAlert({ phone: "6281315265538", failures, checkedAt }, config, request)).status, "retry");
  const coded = (async () => Response.json({ errors: [{ code: 9 }] }, { status: 400 })) as typeof fetch;
  assert.equal((await sendOcaAlert({ phone: "6281315265538", failures, checkedAt }, config, coded)).status, "retry");
});
