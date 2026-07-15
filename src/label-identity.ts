export function labelKey(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase();
}
