import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CliConfig {
  timeoutSeconds?: number;
  defaultLimit?: number;
  host?: string;
  profile?: string;
}

export interface ProjectConfig {
  host?: string;
  profile?: string;
  timeoutSeconds?: number;
  defaultLimit?: number;
}

const DEFAULTS: Required<Pick<CliConfig, "timeoutSeconds" | "defaultLimit">> = {
  timeoutSeconds: 30,
  defaultLimit: 25,
};

export function mergeConfig(
  file: CliConfig,
  project: ProjectConfig,
): Required<Pick<CliConfig, "timeoutSeconds" | "defaultLimit">> & CliConfig {
  return {
    ...DEFAULTS,
    ...file,
    ...project,
  };
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

export async function loadProjectConfig(
  cwd = process.cwd(),
): Promise<ProjectConfig> {
  return (await readJsonFile<ProjectConfig>(join(cwd, ".iserv.json"))) ?? {};
}

export async function loadCliConfig(directory: string): Promise<CliConfig> {
  return (await readJsonFile<CliConfig>(join(directory, "config.json"))) ?? {};
}

export async function saveCliConfig(
  directory: string,
  config: CliConfig,
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "config.json");
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  return path;
}

export { DEFAULTS as CONFIG_DEFAULTS };
