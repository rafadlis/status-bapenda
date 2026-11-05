export function parseIncidentPeriod(form: FormData, now: Date) {
  if (!form.has("from") && !form.has("to")) return null;
  const fromValue = form.get("from");
  const toValue = form.get("to");
  if (typeof fromValue !== "string" || typeof toValue !== "string" || !fromValue.trim() || !toValue.trim()) return undefined;
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to || to > now.getTime()
    || to - from > 90 * 24 * 60 * 60 * 1000) return undefined;
  return { from: new Date(from), to: new Date(to) };
}
