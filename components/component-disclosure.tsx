"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, useContext, useId, useState, type ReactNode } from "react";

type DisclosureState = { open: boolean; panelId: string; toggle: () => void };
const DisclosureContext = createContext<DisclosureState | null>(null);

function useDisclosure() {
  const state = useContext(DisclosureContext);
  if (!state) throw new Error("Component disclosure requires a provider");
  return state;
}

export function ComponentDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <DisclosureContext.Provider value={{ open, panelId, toggle: () => setOpen((value) => !value) }}>
    <div className="reference-service-group">{children}</div>
  </DisclosureContext.Provider>;
}

export function ComponentDisclosureToggle({ count, serviceName = "SAPADA" }: { count: number; serviceName?: string }) {
  const { open, panelId, toggle } = useDisclosure();
  return <button type="button" className="reference-components-toggle" aria-controls={panelId} aria-expanded={open}
    aria-label={`${open ? "Sembunyikan" : "Tampilkan"} ${count} komponen ${serviceName}`} onClick={toggle}>
    <span>{count} komponen</span>
    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden="true" />
  </button>;
}

export function ComponentDisclosurePanel({ children }: { children: ReactNode }) {
  const { open, panelId } = useDisclosure();
  return <div id={panelId} className="reference-components" hidden={!open}>{children}</div>;
}
