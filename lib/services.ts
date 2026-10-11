export const services = [
  {
    key: "sapada",
    name: "SAPADA",
    host: "sapada.bapenda.garutkab.go.id",
    url: "https://sapada.bapenda.garutkab.go.id/",
    repository: "https://github.com/rafadlis/SAPADA",
  },
  {
    key: "struk-berhadiah",
    name: "Struk Berhadiah",
    host: "struk-berhadiah.bapenda.garutkab.go.id",
    url: "https://struk-berhadiah.bapenda.garutkab.go.id/",
    repository: "https://github.com/rafadlis/struk-berhadiah.garutkab.go.id",
  },
  {
    key: "simpul-pad",
    name: "Simpul PAD",
    host: "simpul-pad.bapenda.garutkab.go.id",
    url: "https://simpul-pad.bapenda.garutkab.go.id/",
    repository: "https://github.com/rafadlis/simpul-pad",
  },
  {
    key: "sop-studio",
    name: "SOP Studio",
    host: "sop.bapenda.garutkab.go.id",
    url: "https://sop.bapenda.garutkab.go.id/",
    repository: "https://github.com/rafadlis/sop-studio",
  },
  {
    key: "lms-bapenda",
    name: "Bapenda Belajar",
    host: "lms.bapenda.garutkab.go.id",
    url: "https://lms.bapenda.garutkab.go.id/",
    repository: "https://github.com/rafadlis/lms-bapenda",
  },
  {
    key: "bapenda",
    name: "Bapenda Garut",
    host: "bapenda.garutkab.go.id",
    url: "https://bapenda.garutkab.go.id/",
    repository: null,
  },
] as const;

export type ServiceKey = (typeof services)[number]["key"];

export function getService(value: string | null | undefined) {
  return services.find((service) => service.key === value);
}
