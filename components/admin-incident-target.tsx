"use client";

import { useState } from "react";
import { AdminSelect } from "@/components/admin-select";
import { AdminComponentCheckboxes } from "@/components/admin-component-checkboxes";
import { allServicesKey } from "@/lib/incident-service";
import { services } from "@/lib/services";
import { getIncidentComponents } from "@/lib/incident-components";

export function AdminIncidentTarget() {
  const [serviceKey, setServiceKey] = useState<string>(services[0].key);

  return <>
    <AdminSelect id="serviceKey" label="Layanan" name="serviceKey" defaultValue={services[0].key} required
      onValueChange={(value) => setServiceKey(value ?? "")}
      options={[{ value: allServicesKey, label: "Semua layanan" }, ...services.map((service) => ({ value: service.key, label: service.name }))]} />
    {getIncidentComponents(serviceKey).length > 0 && <AdminComponentCheckboxes key={serviceKey} serviceKey={serviceKey} />}
  </>;
}
