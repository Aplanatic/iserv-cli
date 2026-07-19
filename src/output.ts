import { redactValue } from "@aplanatic/iserv-api";

export function print(value: unknown, json = false): void {
  const safe = redactValue(value);
  if (json || typeof safe !== "string") {
    process.stdout.write(`${JSON.stringify(safe, null, json ? 0 : 2)}\n`);
  } else {
    process.stdout.write(`${safe}\n`);
  }
}

export function fail(error: unknown, json = false): never {
  const message = error instanceof Error ? error.message : String(error);
  if (json) process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  else process.stderr.write(`Error: ${message}\n`);
  process.exitCode = /auth|login|session|credential/i.test(message)
    ? 3
    : /permission|authorized/i.test(message)
      ? 4
      : 1;
  throw new CommanderExit();
}

export class CommanderExit extends Error {}
