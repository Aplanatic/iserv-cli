import type { AuthStatus, RouteDefinition } from "@aplanatic/iserv-api";
import { redactText, redactValue } from "@aplanatic/iserv-api/redaction";
import { presentForDisplay } from "./present.js";

export interface PrintOptions {
  title?: string;
  empty?: string;
  maxRows?: number;
  color?: boolean;
  width?: number;
}

export interface ReadRouteResult {
  routeId: string;
  status: number;
  durationMs: number;
  data: unknown;
  _summary?: string;
}

type ProfileDocument = {
  activeProfile?: string | null;
  profiles?: Array<{ name?: string; hostname?: string; username?: string }>;
};

const ANSI = {
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  gray: 90,
} as const;

function canColor(): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.TERM === "dumb")
    return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return Boolean(process.stdout.isTTY || process.env.FORCE_COLOR);
}

function paint(code: number, value: string, color: boolean): string {
  return color ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export function uiStyle(color = canColor()) {
  return {
    bold: (value: string) => paint(ANSI.bold, value, color),
    dim: (value: string) => paint(ANSI.dim, value, color),
    red: (value: string) => paint(ANSI.red, value, color),
    green: (value: string) => paint(ANSI.green, value, color),
    yellow: (value: string) => paint(ANSI.yellow, value, color),
    blue: (value: string) => paint(ANSI.blue, value, color),
    cyan: (value: string) => paint(ANSI.cyan, value, color),
    gray: (value: string) => paint(ANSI.gray, value, color),
  };
}

function terminalWidth(explicit?: number): number {
  const detected =
    explicit ?? process.stdout.columns ?? Number(process.env.COLUMNS);
  return Number.isFinite(detected)
    ? Math.max(52, Math.min(140, detected))
    : 100;
}

function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words ? `${words[0]?.toUpperCase()}${words.slice(1)}` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: unknown): boolean {
  return (
    value === null ||
    ["string", "number", "boolean", "undefined"].includes(typeof value)
  );
}

function displayValue(value: unknown): string {
  if (value === null) return "\u2014";
  if (value === undefined) return "\u2014";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value || "\u2014";
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (Array.isArray(value))
    return value.length === 0 ? "None" : `${value.length} items`;
  if (isRecord(value)) return `${Object.keys(value).length} fields`;
  return String(value);
}

function oneLine(value: unknown): string {
  return displayValue(value)
    .replace(/\s*\r?\n\s*/g, " \u21B5 ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return "\u2026";
  return `${value.slice(0, width - 1)}\u2026`;
}

function renderHeading(title: string, color: boolean, detail?: string): string {
  const style = uiStyle(color);
  return detail
    ? `${style.bold(title)}  ${style.dim(detail)}`
    : style.bold(title);
}

function renderKeyValues(
  entries: Array<[string, unknown]>,
  color: boolean,
  indent = "",
): string[] {
  if (entries.length === 0) return [];
  const style = uiStyle(color);
  const keyWidth = Math.min(
    28,
    Math.max(...entries.map(([key]) => humanize(key).length)),
  );
  return entries.map(([key, value]) => {
    const label = humanize(key).padEnd(keyWidth);
    return `${indent}${style.dim(label)}  ${oneLine(value)}`;
  });
}

function renderTable(
  rows: Array<Record<string, unknown>>,
  options: Required<Pick<PrintOptions, "maxRows" | "color" | "width">>,
): string[] {
  if (rows.length === 0) return [];
  const style = uiStyle(options.color);
  const visibleRows = rows.slice(0, options.maxRows);
  const keys = [
    ...new Set(visibleRows.flatMap((row) => Object.keys(row))),
  ].slice(0, 10);
  if (keys.length === 0) return [];

  const available = Math.max(
    options.width - (keys.length - 1) * 3 - 2,
    keys.length * 8,
  );
  const preferred = keys.map((key) =>
    Math.min(
      40,
      Math.max(
        humanize(key).length,
        ...visibleRows.map((row) => oneLine(row[key]).length),
      ),
    ),
  );
  const totalPreferred = preferred.reduce((sum, width) => sum + width, 0);
  const widths = preferred.map((width) =>
    totalPreferred <= available
      ? width
      : Math.max(8, Math.floor((width / totalPreferred) * available)),
  );

  const formatRow = (row: Record<string, unknown>) =>
    keys
      .map((key, index) =>
        truncate(oneLine(row[key]), widths[index] ?? 8).padEnd(
          widths[index] ?? 8,
        ),
      )
      .join("   ")
      .trimEnd();
  const header = keys
    .map((key, index) =>
      truncate(humanize(key), widths[index] ?? 8).padEnd(widths[index] ?? 8),
    )
    .join("   ")
    .trimEnd();

  const result = [
    `  ${style.dim(header)}`,
    ...visibleRows.map((row) => `  ${formatRow(row)}`),
  ];
  if (rows.length > visibleRows.length) {
    result.push(
      `  ${style.dim(`\u2026 ${rows.length - visibleRows.length} more`)}`,
    );
  }
  return result;
}

function normalizeRows(value: unknown[]): Array<Record<string, unknown>> {
  return value.map((item) => {
    if (isRecord(item)) return item;
    return { value: item };
  });
}

function renderRecord(
  value: Record<string, unknown>,
  options: Required<Pick<PrintOptions, "maxRows" | "color" | "width">>,
): string[] {
  const lines: string[] = [];
  const scalarEntries = Object.entries(value).filter(([, item]) =>
    scalar(item),
  );
  const collections = Object.entries(value).filter(([, item]) =>
    Array.isArray(item),
  );
  const records = Object.entries(value).filter(([, item]) => isRecord(item));

  lines.push(...renderKeyValues(scalarEntries, options.color));
  for (const [key, items] of collections) {
    if (lines.length > 0) lines.push("");
    const rows = normalizeRows(items as unknown[]);
    lines.push(renderHeading(humanize(key), options.color, `${rows.length}`));
    lines.push(...renderTable(rows, options));
    if (rows.length === 0)
      lines.push(`  ${uiStyle(options.color).dim("None")}`);
  }
  for (const [key, item] of records) {
    if (lines.length > 0) lines.push("");
    lines.push(renderHeading(humanize(key), options.color));
    lines.push(
      ...renderKeyValues(
        Object.entries(item as Record<string, unknown>),
        options.color,
        "  ",
      ),
    );
  }
  return lines;
}

export function formatHuman(
  value: unknown,
  options: PrintOptions = {},
): string {
  const safe = presentForDisplay(redactValue(value));
  const color = options.color ?? canColor();
  const width = terminalWidth(options.width);
  const maxRows = options.maxRows ?? 25;
  const style = uiStyle(color);
  const lines: string[] = [];
  const structured =
    isRecord(safe) &&
    (isTimetableData(safe) ||
      isTimetableDay(safe) ||
      isModuleList(safe) ||
      (Array.isArray(safe.rows) &&
        (Boolean(safe.headers) || typeof safe.title === "string")));
  // Structured renderers print their own titles — avoid News/News doubles
  if (options.title && !structured) {
    lines.push(renderHeading(options.title, color));
  }

  if (
    safe === null ||
    safe === undefined ||
    (Array.isArray(safe) && safe.length === 0)
  ) {
    lines.push(style.dim(options.empty ?? "Nothing to show."));
  } else if (structured) {
    lines.push(...renderStructuredData(safe, style, { color, width, maxRows }));
  } else if (typeof safe === "string") {
    lines.push(safe);
  } else if (Array.isArray(safe)) {
    lines.push(...renderTable(normalizeRows(safe), { color, width, maxRows }));
  } else if (isRecord(safe)) {
    lines.push(...renderRecord(safe, { color, width, maxRows }));
  } else {
    lines.push(displayValue(safe));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function print(
  value: unknown,
  json = false,
  options: PrintOptions = {},
): void {
  const redacted = redactValue(value);
  if (json) {
    process.stdout.write(`${JSON.stringify(redacted)}\n`);
    return;
  }
  process.stdout.write(formatHuman(redacted, options));
}

export function printRouteTree(
  tree: Record<string, RouteDefinition[]>,
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(
      Object.fromEntries(
        Object.entries(tree).map(([module, routes]) => [
          module,
          routes.map((route) => `${route.method} ${route.id} ${route.path}`),
        ]),
      ),
      true,
    );
    return;
  }
  const color = options.color ?? canColor();
  const style = uiStyle(color);
  const modules = Object.entries(tree);
  const total = modules.reduce((sum, [, routes]) => sum + routes.length, 0);
  const lines = [
    renderHeading(
      "Routes",
      color,
      `${total} routes \u00B7 ${modules.length} modules`,
    ),
  ];
  for (const [module, routes] of modules) {
    lines.push("", style.bold(humanize(module)));
    const idWidth = Math.min(
      34,
      Math.max(...routes.map((route) => route.id.length)),
    );
    for (const route of routes) {
      const method = route.method.padEnd(8);
      const methodColor =
        route.method === "GET" || route.method === "HEAD"
          ? style.green
          : style.yellow;
      const id = truncate(route.id, idWidth).padEnd(idWidth);
      lines.push(
        `  ${methodColor(method)} ${style.cyan(id)}  ${style.dim(route.path)}`,
      );
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printRoutes(
  routes: RouteDefinition[],
  query: string,
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(routes, true);
    return;
  }
  const color = options.color ?? canColor();
  const lines = [
    renderHeading(`Routes matching "${query}"`, color, `${routes.length}`),
  ];
  if (routes.length === 0) {
    lines.push(
      uiStyle(color).dim(
        "No routes matched. Try a module name, route ID, or path fragment.",
      ),
    );
  } else {
    lines.push(
      ...renderTable(
        routes.map((route) => ({
          method: route.method,
          id: route.id,
          module: route.module,
          status: route.status,
          summary: route.summary,
        })),
        {
          color,
          width: terminalWidth(options.width),
          maxRows: options.maxRows ?? 25,
        },
      ),
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printRoute(
  route: RouteDefinition,
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(route, true);
    return;
  }
  const color = options.color ?? canColor();
  const style = uiStyle(color);
  const methodColor =
    route.method === "GET" || route.method === "HEAD"
      ? style.green
      : style.yellow;
  const lines = [
    `${methodColor(route.method.padEnd(7))} ${style.bold(route.id)}`,
    route.summary,
    "",
    ...renderKeyValues(
      (
        [
          ["path", route.path],
          ["module", route.module],
          ["authentication", route.authentication],
          ["side effect", route.sideEffect],
          ["status", route.status],
          ["capability", route.capability],
          ["last verified", route.lastVerified],
        ] as Array<[string, unknown]>
      ).filter(([, value]) => value !== undefined),
      color,
    ),
    "",
    style.dim(route.description),
  ];
  if (route.parameters.length > 0) {
    lines.push("", renderHeading("Parameters", color));
    lines.push(
      ...renderTable(
        route.parameters.map((parameter) => ({
          name: parameter.name,
          in: parameter.location,
          required: parameter.required ? "yes" : "no",
          description: parameter.description,
        })),
        { color, width: terminalWidth(options.width), maxRows: 25 },
      ),
    );
  }
  lines.push(
    "",
    `${style.dim("Provenance")}  ${humanize(route.provenance.kind)} \u00B7 ${route.provenance.reference}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printProfiles(
  document: ProfileDocument,
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(document, true);
    return;
  }
  const color = options.color ?? canColor();
  const style = uiStyle(color);
  const profiles = document.profiles ?? [];
  const lines = [renderHeading("Profiles", color, `${profiles.length}`)];
  if (profiles.length === 0) {
    lines.push(
      style.dim("No profiles yet. Run iserv auth login to create one."),
    );
  } else {
    const nameWidth = Math.max(
      ...profiles.map((profile) => (profile.name ?? "unnamed").length),
    );
    for (const profile of profiles) {
      const active = profile.name === document.activeProfile;
      const marker = active ? style.green("\u25CF") : style.dim("\u25CB");
      const name = (profile.name ?? "unnamed").padEnd(nameWidth);
      const details = [profile.username, profile.hostname]
        .filter(Boolean)
        .join(" \u00B7 ");
      lines.push(
        `${marker} ${style.bold(name)}  ${style.dim(details)}`.trimEnd(),
      );
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printAuthStatus(
  status: AuthStatus,
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(status, true);
    return;
  }
  const color = options.color ?? canColor();
  const style = uiStyle(color);
  const state = status.authenticated
    ? style.green("\u25CF Connected")
    : status.configured
      ? style.yellow("\u25CF Session expired")
      : style.dim("\u25CB Not connected");
  const lines = [renderHeading("Session", color), state];
  if (status.profile) lines.push(`${style.dim("Profile")}  ${status.profile}`);
  if (status.account?.displayName)
    lines.push(`${style.dim("Name")}     ${status.account.displayName}`);
  if (status.account?.username)
    lines.push(`${style.dim("Username")} ${status.account.username}`);
  if (status.capabilities?.length) {
    const available = status.capabilities.filter(
      (item) => item.access === "available",
    );
    const limited = status.capabilities.filter(
      (item) => item.access !== "available",
    );
    lines.push(
      "",
      renderHeading(
        "Capabilities",
        color,
        `${available.length} available \u00B7 ${status.capabilitiesVerified === false ? "live check unavailable" : "live checked"}`,
      ),
      ...renderTable(
        status.capabilities.map((item) => ({
          module: item.module,
          access: item.access,
          verifiedReads: item.verifiedReadRoutes,
          catalogued: [
            `${item.catalogued.read} read`,
            item.catalogued.write ? `${item.catalogued.write} write` : "",
            item.catalogued.communicative
              ? `${item.catalogued.communicative} send/create`
              : "",
            item.catalogued.destructive
              ? `${item.catalogued.destructive} destructive`
              : "",
          ]
            .filter(Boolean)
            .join(" \u00B7 "),
        })),
        {
          color,
          width: terminalWidth(options.width),
          maxRows: options.maxRows ?? 40,
        },
      ),
    );
    if (status.capabilitiesVerified === false) {
      lines.push(
        "",
        style.yellow(
          "Module availability could not be refreshed; all entries are shown as unknown.",
        ),
      );
    }
    if (limited.length > 0) {
      lines.push(
        "",
        style.dim(
          `${limited.length} module(s) are experimental, unavailable, or not installed. Write permissions are checked only when an action runs.`,
        ),
      );
    } else {
      lines.push(
        "",
        style.dim("Write permissions are checked only when an action runs."),
      );
    }
  }
  if (!status.authenticated) {
    lines.push(
      "",
      style.dim("Run iserv auth login --url <your-instance> to connect."),
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printSuccess(
  message: string,
  details: unknown = {},
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(details, true);
    return;
  }
  const color = options.color ?? canColor();
  const style = uiStyle(color);
  const redacted = redactValue(details);
  const safe = isRecord(redacted) ? redacted : { result: redacted };
  const lines = [`${style.green("\u2713")} ${style.bold(message)}`];
  lines.push(...renderKeyValues(Object.entries(safe), color, "  "));
  process.stdout.write(`${lines.join("\n")}\n`);
}

function isTimetableData(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.rows) &&
    Array.isArray(value.days) &&
    Array.isArray(value.periods)
  );
}

function isTimetableDay(value: Record<string, unknown>): boolean {
  return (
    typeof value.date === "string" &&
    typeof value.dayName === "string" &&
    Array.isArray(value.rows) &&
    Array.isArray(value.lessons) &&
    !Array.isArray(value.days)
  );
}

function isModuleList(value: Record<string, unknown>): boolean {
  return Array.isArray(value.items) && typeof value.title === "string";
}

function renderStructuredData(
  value: unknown,
  style: ReturnType<typeof uiStyle>,
  options: Required<Pick<PrintOptions, "maxRows" | "color" | "width">>,
): string[] {
  if (!isRecord(value)) {
    return renderRecord({ result: value }, options);
  }

  // Timetable week grid
  if (isTimetableData(value)) {
    const lines: string[] = [];
    const detail = [
      value.class ? String(value.class) : undefined,
      value.startDate && value.endDate
        ? `${value.startDate} \u2013 ${value.endDate}`
        : undefined,
      value.lastUpdated ? `updated ${value.lastUpdated}` : undefined,
    ]
      .filter(Boolean)
      .join(" \u00B7 ");
    lines.push(renderHeading("Timetable", options.color, detail || undefined));
    if (value.requestedStart) {
      lines.push(
        style.dim(
          `Week snapped from ${String(value.requestedStart)} to Monday ${String(value.startDate)}`,
        ),
      );
    }
    const rows = value.rows as Array<Record<string, unknown>>;
    lines.push(
      ...renderTable(rows, { ...options, maxRows: options.maxRows ?? 20 }),
    );
    const changes = Array.isArray(value.changes) ? value.changes : [];
    if (changes.length > 0) {
      lines.push(
        "",
        renderHeading("Changes", options.color, `${changes.length}`),
        ...renderTable(normalizeRows(changes), options),
      );
    } else if (isRecord(value.visibility)) {
      const note = value.visibility.note
        ? String(value.visibility.note)
        : undefined;
      const url = value.visibility.substitutionsUrl
        ? String(value.visibility.substitutionsUrl)
        : undefined;
      if (note || url) {
        lines.push("");
        if (note) lines.push(style.dim(note));
        if (url) lines.push(style.dim(`Substitutions: ${url}`));
      }
    }
    return lines;
  }

  // Timetable day (today / --date)
  if (isTimetableDay(value)) {
    const lines: string[] = [];
    const detail = [
      value.class ? String(value.class) : undefined,
      `${String(value.dayName)} ${String(value.date)}`,
      value.lastUpdated ? `updated ${value.lastUpdated}` : undefined,
    ]
      .filter(Boolean)
      .join(" \u00B7 ");
    lines.push(
      renderHeading("Timetable today", options.color, detail || undefined),
    );
    if (value.empty || (value.rows as unknown[]).length === 0) {
      lines.push(style.dim(String(value.message ?? "No lessons today.")));
      return lines;
    }
    lines.push(
      ...renderTable(value.rows as Array<Record<string, unknown>>, {
        ...options,
        maxRows: options.maxRows ?? 20,
      }),
    );
    const changes = Array.isArray(value.changes) ? value.changes : [];
    if (changes.length > 0) {
      lines.push(
        "",
        renderHeading("Changes", options.color, `${changes.length}`),
        ...renderTable(normalizeRows(changes), options),
      );
    } else if (isRecord(value.visibility)) {
      const note = value.visibility.note
        ? String(value.visibility.note)
        : undefined;
      const url = value.visibility.substitutionsUrl
        ? String(value.visibility.substitutionsUrl)
        : undefined;
      if (note || url) {
        lines.push("");
        if (note) lines.push(style.dim(note));
        if (url) lines.push(style.dim(`Substitutions: ${url}`));
      }
    }
    return lines;
  }

  // Module list results { title, items, message, empty }
  if (isModuleList(value)) {
    const lines: string[] = [];
    const items = value.items as unknown[];
    if (value.title) {
      lines.push(renderHeading(String(value.title), options.color));
    }
    if (value.message && (value.empty || items.length === 0)) {
      lines.push(style.dim(String(value.message)));
      return lines;
    }
    if (items.length === 0) {
      lines.push(style.dim(String(value.message ?? "Nothing to show.")));
      return lines;
    }
    // Single news/article detail with a body — render as readable article
    if (
      items.length === 1 &&
      isRecord(items[0]) &&
      typeof items[0].body === "string" &&
      items[0].body.trim().length > 0
    ) {
      const detail = items[0];
      if (typeof detail.meta === "string" && detail.meta.trim()) {
        lines.push(style.dim(String(detail.meta)));
      }
      lines.push("", String(detail.body));
      return lines;
    }
    // Avoid repeating the outer print() title when present
    lines.push(
      ...renderTable(normalizeRows(items), {
        ...options,
        maxRows: options.maxRows ?? 40,
      }),
    );
    if (value.message) {
      lines.push("", style.dim(String(value.message)));
    }
    return lines;
  }

  // Projected HTML extract { title, rows, headers, items, fields, message }
  if (
    value.rows &&
    Array.isArray(value.rows) &&
    (value.headers || value.title)
  ) {
    const lines: string[] = [];
    if (value.title)
      lines.push(renderHeading(String(value.title), options.color));
    lines.push(...renderTable(normalizeRows(value.rows as unknown[]), options));
    return lines;
  }

  if (Array.isArray(value.items)) {
    const lines: string[] = [];
    if (value.title)
      lines.push(renderHeading(String(value.title), options.color));
    if (value.message && (value.items as unknown[]).length === 0) {
      lines.push(style.dim(String(value.message)));
      return lines;
    }
    lines.push(
      ...renderTable(normalizeRows(value.items as unknown[]), options),
    );
    return lines;
  }

  if (value.fields && isRecord(value.fields)) {
    const lines: string[] = [];
    if (value.title)
      lines.push(renderHeading(String(value.title), options.color));
    lines.push(
      ...renderKeyValues(
        Object.entries(value.fields as Record<string, unknown>),
        options.color,
      ),
    );
    return lines;
  }

  if (typeof value.message === "string" && Object.keys(value).length <= 3) {
    return [style.dim(String(value.message))];
  }

  return renderRecord(value, options);
}

export function printReadRoute(
  title: string,
  result: ReadRouteResult,
  json = false,
  options: PrintOptions = {},
): void {
  if (json) {
    print(
      {
        routeId: result.routeId,
        status: result.status,
        durationMs: result.durationMs,
        ...(result._summary ? { summary: result._summary } : {}),
        data: result.data,
      },
      true,
    );
    return;
  }
  const color = options.color ?? canColor();
  const style = uiStyle(color);
  const safe = presentForDisplay(redactValue(result.data));
  const state =
    result.status >= 200 && result.status < 300
      ? style.green("\u25CF OK")
      : style.yellow("\u25CF Unexpected response");
  const lines = [
    renderHeading(title, color),
    `${state}  ${style.dim(`${result.status} \u00B7 ${result.durationMs} ms`)}`,
  ];

  lines.push(
    "",
    ...renderStructuredData(safe, style, {
      color,
      width: terminalWidth(options.width),
      maxRows: options.maxRows ?? 40,
    }),
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

function errorExitCode(message: string): number {
  if (/auth|login|session|credential/i.test(message)) return 3;
  if (/permission|authorized/i.test(message)) return 4;
  return 1;
}

function errorHint(message: string): string | undefined {
  if (/auth|login|session|credential/i.test(message))
    return "Run iserv auth login --url <your-instance> to reconnect.";
  if (/permission|authorized/i.test(message))
    return "The active account may not have access to this module or operation.";
  if (/unknown route/i.test(message))
    return "Run iserv routes search <query> to find a route ID.";
  if (/missing required parameter|name=value/i.test(message))
    return "Pass route parameters with --param name=value.";
  if (/news id|news entry/i.test(message))
    return "Run iserv news list to discover readable entry ids.";
  if (/invalid .*date|start date must/i.test(message))
    return "Use DD.MM.YYYY or YYYY-MM-DD, and keep start on or before end.";
  return undefined;
}

export function fail(error: unknown, json = false): never {
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactText(raw);
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  const code =
    status && status >= 400 && status < 600 ? status : errorExitCode(message);
  if (json) {
    // Always emit one JSON object on stdout so --json pipelines stay valid
    process.stdout.write(
      `${JSON.stringify({
        error: message,
        code,
        ...(status ? { status } : {}),
      })}\n`,
    );
  } else {
    const style = uiStyle();
    process.stderr.write(`${style.red("\u2715")} ${style.bold(message)}\n`);
    const hint = errorHint(message);
    if (hint) process.stderr.write(`${style.dim(`  ${hint}`)}\n`);
    if (process.env.ISERV_DEBUG) {
      process.stderr.write(`${style.dim(`  Exit code: ${code}`)}\n`);
    }
  }
  process.exitCode = code >= 256 ? 1 : code;
  throw new CommanderExit();
}

export class CommanderExit extends Error {}
