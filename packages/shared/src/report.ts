export function normalizeReportFileRefs(fileRefs: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const fileRef of fileRefs) {
    const trimmed = fileRef.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}
