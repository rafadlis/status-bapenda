import { getServiceComponents, legacyPaymentComponent, legacyQrisComponent, skippedComponentKeys } from "@/lib/components";
import { getService, services } from "@/lib/services";

export function incidentAffectsMonitoring(incident: { serviceKey: string; affectedComponentKeys: string[] | null }) {
  return !getIncidentComponents(incident.serviceKey).length || !incident.affectedComponentKeys?.length
    || incident.affectedComponentKeys.some((key) => !skippedComponentKeys.includes(key));
}

export function getIncidentComponents(serviceKey: string) {
  const service = getService(serviceKey);
  const children = getServiceComponents(serviceKey);
  return service && children.length
    ? [{ key: service.key, name: `Situs ${service.name}` }, ...children]
    : [];
}

export const sapadaIncidentComponents = getIncidentComponents("sapada");

const historicalIncidentComponents = [...services.flatMap((service) => getIncidentComponents(service.key)), legacyPaymentComponent, legacyQrisComponent];

export function parseAffectedComponentKeys(serviceKey: string, values: FormDataEntryValue[]) {
  const choices = getIncidentComponents(serviceKey);
  if (!choices.length) return values.length === 0 ? null : undefined;
  const allowed = serviceKey === "sapada" ? [...choices, legacyPaymentComponent, legacyQrisComponent] : choices;
  const componentKeys = new Set<string>(allowed.map((component) => component.key));
  const keys = values.map(String);
  if (keys.length === 0 || keys.length > componentKeys.size || new Set(keys).size !== keys.length || keys.some((key) => !componentKeys.has(key))) {
    return undefined;
  }
  return keys;
}

export function affectedComponentNames(keys: string[] | null) {
  if (!keys) return [];
  return historicalIncidentComponents.filter((component) => keys.includes(component.key)).map((component) => component.name);
}
