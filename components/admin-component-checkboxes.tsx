"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { getIncidentComponents } from "@/lib/incident-components";
import { legacyPaymentComponent, legacyQrisComponent } from "@/lib/components";
import { getService } from "@/lib/services";

export function AdminComponentCheckboxes({ serviceKey = "sapada", defaultSelected = [] }: { serviceKey?: string; defaultSelected?: string[] }) {
  const options = [...getIncidentComponents(serviceKey),
    ...[legacyPaymentComponent, legacyQrisComponent].filter((component) => serviceKey === "sapada" && defaultSelected.includes(component.key))];
  return <fieldset className="admin-component-fieldset">
    <legend>Komponen terdampak</legend>
    <p>Pilih komponen {getService(serviceKey)?.name} yang mengalami gangguan atau pemeliharaan.</p>
    <div className="admin-component-options">{options.map((component) => <label key={component.key} className="admin-component-option">
      <Checkbox name="componentKeys" value={component.key} defaultChecked={defaultSelected.includes(component.key)} aria-label={component.name} />
      <span>{component.name}</span>
    </label>)}</div>
  </fieldset>;
}
