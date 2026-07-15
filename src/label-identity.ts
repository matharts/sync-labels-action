export function labelKey(value: unknown): string {
  // oxlint-disable-next-line typescript/no-base-to-string -- Preserve existing label identity coercion for migration parity.
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase();
}
