export const sapadaComponents = [
  { key: "sapada-tte", name: "TTE", parentKey: "sapada" },
  { key: "sapada-storage", name: "Storage", parentKey: "sapada" },
  { key: "sapada-qris-generate", name: "Generate QRIS", parentKey: "sapada" },
  { key: "sapada-qris-check", name: "Cek Status QRIS", parentKey: "sapada" },
  { key: "sapada-va-bjb", name: "Virtual Account BJB", parentKey: "sapada" },
  { key: "sapada-kode-bayar", name: "Kode Bayar", parentKey: "sapada" },
  { key: "sapada-atr-bpn", name: "ATR BPN API", parentKey: "sapada" },
] as const;

export const simpulPadComponents = [
  { key: "simpul-pad-login", name: "Login", parentKey: "simpul-pad" },
  { key: "simpul-pad-qris", name: "QRIS", parentKey: "simpul-pad" },
  { key: "simpul-pad-va", name: "Virtual Account BJB", parentKey: "simpul-pad" },
  { key: "simpul-pad-api", name: "API", parentKey: "simpul-pad" },
] as const;

export const components = [...sapadaComponents, ...simpulPadComponents] as const;

// Retained for recorded checks and incidents, never shown as a current monitor.
export const legacyPaymentComponent = { key: "sapada-payment", name: "Payment API", parentKey: "sapada" } as const;
export const legacyQrisComponent = { key: "sapada-qris", name: "QRIS (gabungan)", parentKey: "sapada" } as const;
export const skippedComponentKeys: readonly string[] = ["sapada-qris-check"];
export const monitoredComponents = components.filter((component) => !skippedComponentKeys.includes(component.key));
export const paymentComponentKeys = ["sapada-qris-generate", "sapada-qris-check", "sapada-va-bjb", "sapada-kode-bayar"] as const;
export const monitoredPaymentComponentKeys = paymentComponentKeys.filter((key) => !skippedComponentKeys.includes(key));
export const sapadaHistoryKeys = ["sapada", ...sapadaComponents.filter((component) => !skippedComponentKeys.includes(component.key)).map((component) => component.key), legacyPaymentComponent.key, legacyQrisComponent.key];

export function getServiceComponents(parentKey: string) {
  return components.filter((component) => component.parentKey === parentKey);
}

export function getMonitoredServiceKeys(parentKey: string) {
  return [parentKey, ...getServiceComponents(parentKey).filter((component) => !skippedComponentKeys.includes(component.key)).map((component) => component.key)];
}

export function getServiceHistoryKeys(parentKey: string) {
  return parentKey === "sapada" ? sapadaHistoryKeys : getMonitoredServiceKeys(parentKey);
}

export function getComponent(value: string | null | undefined) {
  return components.find((component) => component.key === value)
    ?? (value === legacyPaymentComponent.key ? legacyPaymentComponent
      : value === legacyQrisComponent.key ? legacyQrisComponent : undefined);
}
