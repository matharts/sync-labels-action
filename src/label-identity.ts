export function labelKey(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase();
}

export function escapePathSegment(value: unknown): string {
  return encodeURIComponent(String(value ?? "")).replace(/[!'()~]/g, (character) =>
    `%${character.codePointAt(0)?.toString(16).toUpperCase()}`,
  );
}

export function repositoryPath(fullName: string): string {
  const separator = fullName.indexOf("/");
  const owner = separator >= 0 ? fullName.slice(0, separator) : "";
  const repository = separator >= 0 ? fullName.slice(separator + 1) : "";

  if (owner.length === 0 || repository.length === 0) {
    throw new Error(`无效仓库名称：${JSON.stringify(fullName)}`);
  }

  return `${escapePathSegment(owner)}/${escapePathSegment(repository)}`;
}
