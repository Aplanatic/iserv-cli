import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface IdempotencyDocument {
  version: 1;
  completed: Record<string, { at: string; action: string }>;
}

async function readStore(directory: string): Promise<IdempotencyDocument> {
  try {
    const parsed = JSON.parse(
      await readFile(join(directory, "idempotency.json"), "utf8"),
    ) as IdempotencyDocument;
    if (parsed.version !== 1 || typeof parsed.completed !== "object") {
      return { version: 1, completed: {} };
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, completed: {} };
    }
    throw error;
  }
}

async function writeStore(
  directory: string,
  document: IdempotencyDocument,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "idempotency.json");
  const temporary = `${path}.${process.pid}.tmp`;
  // Keep the last 200 completed keys
  const entries = Object.entries(document.completed)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, 200);
  const trimmed: IdempotencyDocument = {
    version: 1,
    completed: Object.fromEntries(entries),
  };
  await writeFile(temporary, `${JSON.stringify(trimmed, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function findCompletedIdempotency(
  directory: string,
  key: string,
): Promise<{ at: string; action: string } | undefined> {
  const document = await readStore(directory);
  return document.completed[key];
}

export async function markIdempotencyCompleted(
  directory: string,
  key: string,
  action: string,
): Promise<void> {
  const document = await readStore(directory);
  document.completed[key] = { at: new Date().toISOString(), action };
  await writeStore(directory, document);
}
