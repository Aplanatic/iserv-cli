export function parseParameters(
  entries: string[] = [],
): Record<string, string> {
  return Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf("=");
      if (separator < 1)
        throw new Error(`Invalid parameter '${entry}'; expected name=value`);
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}
