import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IServClient } from "@aplanatic/iserv-api";
import { Command, CommanderError, Option } from "commander";
import {
  type CliConfig,
  CONFIG_DEFAULTS,
  loadCliConfig,
  loadProjectConfig,
  mergeConfig,
  saveCliConfig,
} from "./config.js";
import {
  findCompletedIdempotency,
  markIdempotencyCompleted,
} from "./idempotency.js";
import {
  CommanderExit,
  emitHelpJson,
  fail,
  type PrintOptions,
  print,
  printAuthStatus,
  printProfiles,
  printReadRoute,
  printRoute,
  printRoutes,
  printRouteTree,
  printWriteSuccess,
  uiStyle,
} from "./output.js";
import { parseParameters } from "./parameters.js";

const CLI_NAME = "@aplanatic/iserv-cli";
const CLI_VERSION = "0.6.11";
const DEFAULT_LIMIT = String(CONFIG_DEFAULTS.defaultLimit);

const program = new Command();
const helpStyle = () => uiStyle();
program
  .name("iserv")
  .description("A calm, secure command line for your IServ account")
  .showSuggestionAfterError()
  .showHelpAfterError("Run with --help to see available commands.")
  .exitOverride()
  .configureHelp({
    sortOptions: true,
    sortSubcommands: true,
    styleTitle: (value) => helpStyle().bold(value),
    styleCommandText: (value) => helpStyle().cyan(value),
    styleOptionText: (value) => helpStyle().cyan(value),
    styleArgumentText: (value) => helpStyle().yellow(value),
    styleSubcommandText: (value) => helpStyle().cyan(value),
  });
program
  .option("--json", "emit stable machine-readable JSON")
  .option("--debug", "write diagnostics and stack traces to stderr")
  .option("--verbose", "alias for --debug")
  .option(
    "--timeout <seconds>",
    "HTTP request timeout in seconds (default: 30, or ISERV_TIMEOUT_MS)",
  )
  .option(
    "--portable",
    "use ./.iserv in the current directory for config and profiles",
  )
  .option("-V, --version", "output the version number")
  .addHelpText("after", () => {
    const h = helpStyle();
    return `\n${h.bold("Start here")}\n  ${h.cyan("iserv auth login --url <your-instance>")}\n  ${h.cyan("iserv auth status")}\n  ${h.cyan("iserv routes tree")}\n`;
  })
  .action((options: { version?: boolean; json?: boolean }) => {
    applyGlobalFlags();
    if (options.version) {
      emitVersion(Boolean(options.json));
      return;
    }
    if (options.json) {
      emitRootHelpJson(program);
      return;
    }
    program.outputHelp();
  });

const jsonOutput = () => Boolean(program.opts().json);
let runtimeConfig: CliConfig & {
  timeoutSeconds: number;
  defaultLimit: number;
} = {
  ...CONFIG_DEFAULTS,
};
let configDirectoryPromise: Promise<string> | undefined;
let configReady: Promise<void> | undefined;

const applyGlobalFlags = (): void => {
  const opts = program.opts<{
    debug?: boolean;
    verbose?: boolean;
    timeout?: string;
    portable?: boolean;
  }>();
  if (opts.portable) process.env.ISERV_PORTABLE = "1";
  if (opts.debug || opts.verbose) process.env.ISERV_DEBUG = "1";
  if (opts.timeout !== undefined) {
    const seconds = Number(opts.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("--timeout must be a positive number of seconds");
    }
    process.env.ISERV_TIMEOUT_MS = String(Math.round(seconds * 1000));
  }
};

const configDirectory = () =>
  (configDirectoryPromise ??= api().then(({ resolveConfigDirectory }) =>
    resolveConfigDirectory(),
  ));

const ensureConfig = () =>
  (configReady ??= (async () => {
    applyGlobalFlags();
    const directory = await configDirectory();
    runtimeConfig = mergeConfig(
      await loadCliConfig(directory),
      await loadProjectConfig(),
    );
    if (!process.env.ISERV_TIMEOUT_MS && runtimeConfig.timeoutSeconds) {
      process.env.ISERV_TIMEOUT_MS = String(
        Math.round(runtimeConfig.timeoutSeconds * 1000),
      );
    }
  })());

const emitVersion = (json: boolean): void => {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ name: CLI_NAME, version: CLI_VERSION })}\n`,
    );
    return;
  }
  process.stdout.write(`${CLI_VERSION}\n`);
};
const emitRootHelpJson = (cmd: Command): void => {
  emitHelpJson({
    name: CLI_NAME,
    version: CLI_VERSION,
    description: cmd.description(),
    options: cmd.options.map((option) => ({
      flags: option.flags,
      description: option.description,
    })),
    commands: cmd.commands
      .filter((sub) => !(sub as Command & { _hidden?: boolean })._hidden)
      .map((sub) => ({
        name: sub.name(),
        description: sub.description(),
        ...(sub.aliases().length > 0 ? { aliases: sub.aliases() } : {}),
      })),
  });
};
const collectOption = (value: string, previous: string[] = []): string[] => {
  previous.push(value);
  return previous;
};
const requireInteractiveTty = (action: string): void => {
  if (process.stdin.isTTY && process.stdout.isTTY) return;
  throw new Error(
    `TTY required for ${action}. Run this command in an interactive terminal (not a pipe).`,
  );
};
const resolveIdempotencyKey = (provided?: string): string =>
  provided?.trim() || crypto.randomUUID();
const claimIdempotencyKey = async (
  _action: string,
  key: string,
): Promise<"new" | "completed"> => {
  const directory = await configDirectory();
  const prior = await findCompletedIdempotency(directory, key);
  return prior ? "completed" : "new";
};
const completeIdempotencyKey = async (
  action: string,
  key: string,
): Promise<void> => {
  await markIdempotencyCompleted(await configDirectory(), key, action);
};
let apiPromise: Promise<typeof import("@aplanatic/iserv-api")> | undefined;
const api = () => (apiPromise ??= import("@aplanatic/iserv-api"));
let catalogPromise:
  | Promise<typeof import("@aplanatic/iserv-api/catalog")>
  | undefined;
const catalog = () =>
  (catalogPromise ??= import("@aplanatic/iserv-api/catalog"));
let brokerPromise:
  | Promise<import("@aplanatic/iserv-api").AuthBroker>
  | undefined;
const broker = () =>
  (brokerPromise ??= api().then(({ AuthBroker }) => new AuthBroker()));
const restoreClient = async () => (await broker()).restore();
const restoreMessengerClient = async () => (await broker()).restoreMessenger();
const boundedLimit = (value: string, maximum = 100): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Limit must be an integer between 1 and ${maximum}`);
  }
  return parsed;
};
/** Writes require an explicit --confirm. */
const requireWriteConfirm = (
  options: { confirm?: boolean },
  action: string,
): void => {
  if (options.confirm) return;
  throw new Error(`Write blocked: ${action}. Pass --confirm to proceed.`);
};
const resolveSearchQuery = (
  positional: string | undefined,
  options: { query?: string },
): string => {
  const value = (options.query ?? positional ?? "").trim();
  if (!value) {
    throw new Error(
      'Missing search query. For terms starting with "-", use: iserv search --query=--json (or: iserv search -- "--json").',
    );
  }
  return value;
};
const registerUnavailableModule = (
  name: string,
  summary: string,
  reason: string,
) => {
  const cmd = program.command(name, { hidden: true }).description(summary);
  const failUnavailable = () => {
    fail(
      new Error(`${name} is not available in this CLI: ${reason}`),
      jsonOutput(),
    );
  };
  cmd
    .command("show")
    .description(`Unavailable — ${reason}`)
    .action(failUnavailable);
  cmd
    .command("launch")
    .description(`Unavailable — ${reason}`)
    .action(failUnavailable);
  cmd
    .command("list")
    .description(`Unavailable — ${reason}`)
    .action(failUnavailable);
  cmd.action(failUnavailable);
};
const run =
  <T extends unknown[]>(
    action: (...args: T) => Promise<unknown>,
    options: PrintOptions = {},
  ) =>
  async (...args: T) => {
    try {
      const result = await action(...args);
      if (result !== undefined) print(result, jsonOutput(), options);
    } catch (error) {
      if (error instanceof CommanderExit) return;
      fail(error, jsonOutput());
    }
  };
const withClient = (
  action: (client: IServClient) => Promise<unknown>,
  options: PrintOptions = {},
) => run(async () => action(await restoreClient()), options);
const withMessengerClient = (
  action: (client: IServClient) => Promise<unknown>,
  options: PrintOptions = {},
) => run(async () => action(await restoreMessengerClient()), options);

async function readRoute(
  routeId: string,
  title: string,
  parameters: Record<string, string | number | boolean> = {},
): Promise<void> {
  try {
    const result = await (await restoreClient()).executeReadRoute(
      routeId,
      parameters,
    );
    printReadRoute(title, result, jsonOutput());
  } catch (error) {
    fail(error, jsonOutput());
  }
}

const auth = program
  .command("auth")
  .description("Authenticate and manage the active session");
auth
  .command("login")
  .description("Connect an account and save its session in the system keychain")
  .option("--url <url>", "IServ instance URL (or set ISERV_HOST / ISERV_URL)")
  .option("--profile <name>", "profile name", "default")
  .option("--username <name>", "account name")
  .addOption(
    new Option("--browser", "complete login in a local browser").conflicts(
      "terminal",
    ),
  )
  .addOption(
    new Option("--terminal", "complete login in the terminal").conflicts(
      "browser",
    ),
  )
  .option(
    "--allow-private-host",
    "allow an explicitly configured private-network host",
  )
  .addHelpText("after", () => {
    const h = helpStyle();
    return `\n${h.bold("Examples")}\n  ${h.cyan("iserv auth login --url iserv.example")}\n  ${h.cyan("iserv auth login --url iserv.example --browser")}\n`;
  })
  .action(async (options) => {
    try {
      await ensureConfig();
      const url =
        options.url ??
        process.env.ISERV_URL ??
        process.env.ISERV_HOST ??
        runtimeConfig.host;
      if (!url) {
        throw new Error(
          "Missing instance URL. Pass --url <host>, set ISERV_HOST / ISERV_URL, or add host to .iserv.json / config.",
        );
      }
      const { normalizeInstanceUrl } = await api();
      // Validate before any interactive prompts so bad URLs fail cleanly in pipes.
      normalizeInstanceUrl(
        url,
        options.allowPrivateHost ? { allowPrivateHost: true } : {},
      );
      requireInteractiveTty("auth login");
      const { input, password } = await import("@inquirer/prompts");
      const username =
        options.username ?? (await input({ message: "Account name" }));
      const authBroker = await broker();
      if (options.browser) {
        await authBroker.loginBrowser({
          profile: options.profile,
          url,
          username,
          allowPrivateHost: options.allowPrivateHost,
        });
      } else {
        const secret = await password({ message: "Password", mask: "•" });
        await authBroker.login({
          profile: options.profile,
          url,
          username,
          password: secret,
          allowPrivateHost: options.allowPrivateHost,
          challengeHandler: async (challenge) =>
            password({ message: challenge.prompt, mask: "•" }),
        });
      }
      printWriteSuccess(
        "Connected",
        { profile: options.profile, username, authenticated: true },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
auth
  .command("status")
  .description("Check whether a saved profile is connected")
  .option("--profile <name>")
  .action(async (options: { profile?: string }) => {
    try {
      printAuthStatus(
        await (await broker()).status(options.profile),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
auth
  .command("logout")
  .description(
    "End the remote session and remove it from the keychain (requires --confirm)",
  )
  .option("--profile <name>")
  .option("--confirm", "required acknowledgement that this ends the session")
  .action(async (options: { profile?: string; confirm?: boolean }) => {
    try {
      requireWriteConfirm(options, "auth logout");
      await (await broker()).logout(options.profile);
      printWriteSuccess("Logged out", { loggedOut: true }, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const profile = program.command("profile").description("Manage local profiles");
profile
  .command("list")
  .description("List saved profiles and show the active one")
  .action(async () => {
    try {
      const { ProfileStore } = await api();
      printProfiles(await new ProfileStore().read(), jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
profile
  .command("use <name>")
  .description("Make a saved profile active")
  .action(async (name?: string) => {
    try {
      const { ProfileStore } = await api();
      await new ProfileStore().setActive(String(name));
      printWriteSuccess(
        "Active profile changed",
        { activeProfile: name },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
profile
  .command("remove <name>")
  .description("Log out and remove a saved profile (requires --confirm)")
  .option("--confirm", "required acknowledgement that this removes the profile")
  .action(async (name: string, options: { confirm?: boolean }) => {
    try {
      requireWriteConfirm(options, "profile remove");
      const authBroker = await broker();
      await authBroker.logout(String(name));
      const removed = await authBroker.profiles.remove(String(name));
      printWriteSuccess(
        "Profile removed",
        {
          removed: name,
          ...(removed.backupPath ? { backupPath: removed.backupPath } : {}),
        },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const routes = program
  .command("routes")
  .description("Inspect and safely probe the route catalog")
  .addHelpText("after", () => {
    const h = helpStyle();
    return `\n${h.bold("Examples")}\n  ${h.cyan("iserv routes tree")}\n  ${h.cyan("iserv routes search calendar")}\n  ${h.cyan("iserv routes show calendar.upcoming")}\n`;
  });
routes
  .command("tree")
  .description("Browse every catalogued route by module")
  .action(async () =>
    printRouteTree((await catalog()).routeCatalog.tree(), jsonOutput()),
  );
routes
  .command("search <query>")
  .description("Find routes by ID, module, path, or description")
  .option("--module <module>", "restrict to one module")
  .option("--method <method>", "restrict to one HTTP method")
  .option(
    "--effect <effect>",
    "restrict to read, write, communicative, or destructive",
  )
  .option(
    "--status <status>",
    "restrict to supported, experimental, documented-only, or deprecated",
  )
  .option("--limit <number>", "maximum matches", "25")
  .action(async (query, options) => {
    if (!String(query).trim()) {
      fail(new Error("Search query must not be empty."), jsonOutput());
    }
    const { routeCatalog } = await catalog();
    printRoutes(
      routeCatalog.search(query, {
        ...(options.module ? { module: options.module } : {}),
        ...(options.method ? { method: options.method.toUpperCase() } : {}),
        ...(options.effect ? { sideEffect: options.effect } : {}),
        ...(options.status ? { status: options.status } : {}),
        limit: boundedLimit(options.limit),
      }),
      query,
      jsonOutput(),
    );
  });

program
  .command("search")
  .description(
    'Quickly search routes and visible users. For queries starting with "-", use --query=... or --.',
  )
  .argument("[query]", "search text (optional when --query is set)")
  .option(
    "--query <query>",
    'search text (preferred when the query starts with "-", e.g. --query=--json)',
  )
  .addOption(
    new Option("--scope <scope>", "search all, routes, or users")
      .choices(["all", "routes", "users"])
      .default("all"),
  )
  .option(
    "--limit <number>",
    "maximum results per source (1-50)",
    DEFAULT_LIMIT,
  )
  .action(
    async (
      positional: string | undefined,
      options: { scope: string; limit: string; query?: string },
    ) => {
      try {
        const query = resolveSearchQuery(positional, options);
        const startedAt = performance.now();
        const limit = boundedLimit(options.limit, 50);
        const routePromise =
          options.scope === "users"
            ? Promise.resolve([])
            : catalog().then(({ routeCatalog }) =>
                routeCatalog.search(query, { limit }).map((route) => ({
                  id: route.id,
                  method: route.method,
                  module: route.module,
                  status: route.status,
                  summary: route.summary,
                })),
              );
        const userPromise =
          options.scope === "routes"
            ? Promise.resolve({
                users: [],
                warning: undefined as string | undefined,
              })
            : restoreClient()
                .then((client) => client.users.searchAutocomplete(query, limit))
                .then((users) => ({
                  users,
                  warning: undefined as string | undefined,
                }))
                .catch(() => ({
                  users: [] as unknown[],
                  warning: "User search is temporarily unavailable.",
                }));
        const [matchedRoutes, userResult] = await Promise.all([
          routePromise,
          userPromise,
        ]);
        print(
          {
            query,
            scope: options.scope,
            durationMs: Math.round(performance.now() - startedAt),
            routes: matchedRoutes,
            users: userResult.users,
            ...(userResult.warning ? { warnings: [userResult.warning] } : {}),
          },
          jsonOutput(),
          { title: `Search · ${query}`, maxRows: limit },
        );
      } catch (error) {
        fail(error, jsonOutput());
      }
    },
  );
routes
  .command("show <routeId>")
  .description("Show the contract and provenance for one route")
  .action(async (routeId) => {
    try {
      printRoute((await catalog()).routeCatalog.get(routeId), jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
routes
  .command("probe <routeId>")
  .description("Run a catalogued read-only route with the active profile")
  .option(
    "--param <name=value>",
    "route parameter",
    (value, previous: string[]) => [...previous, value],
    [],
  )
  .action(async (routeId, options) => {
    try {
      const result = await (await restoreClient()).executeReadRoute(
        routeId,
        parseParameters(options.param),
      );
      printReadRoute(`Probe \u00B7 ${routeId}`, result, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
routes
  .command("probe-many <routeIds...>")
  .description("Run up to eight catalogued read-only routes concurrently")
  .option("--concurrency <number>", "parallel requests", "4")
  .action(async (routeIds: string[], options: { concurrency: string }) => {
    try {
      const results = await (await restoreClient()).executeReadRoutes(
        routeIds.map((routeId) => ({ routeId })),
        { concurrency: boundedLimit(options.concurrency, 8) },
      );
      if (jsonOutput()) {
        print(
          results.map((result) => ({
            routeId: result.routeId,
            status: result.status,
            durationMs: result.durationMs,
            ...(result._summary ? { summary: result._summary } : {}),
            data: result.data,
          })),
          true,
        );
        return;
      }
      for (const result of results) {
        printReadRoute(result.routeId, result, false);
        process.stdout.write("\n");
      }
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
routes
  .command("serve")
  .description(
    "Open the local interactive route explorer (loopback-only, token auth)",
  )
  .option("--port <number>", "bind port (default: ephemeral)")
  .option("--no-open", "do not open a browser")
  .action(async (options: { port?: string; open?: boolean }) => {
    try {
      await ensureConfig();
      const apiEntry = fileURLToPath(
        import.meta.resolve("@aplanatic/iserv-api"),
      );
      const assetsDirectory = join(
        dirname(dirname(apiEntry)),
        "explorer",
        "dist",
      );
      let client: IServClient | undefined;
      try {
        client = await restoreClient();
      } catch {
        /* Documentation-only mode. */
      }
      const port =
        options.port !== undefined ? Number(options.port) : undefined;
      if (
        port !== undefined &&
        (!Number.isInteger(port) || port < 1 || port > 65535)
      ) {
        throw new Error("--port must be an integer between 1 and 65535");
      }
      const server = await (await api()).startExplorerServer({
        ...(client ? { client } : {}),
        assetsDirectory,
        ...(port !== undefined ? { port } : {}),
      });
      process.stdout.write(
        `${helpStyle().green("●")} ${helpStyle().bold("Explorer ready")}\n` +
          `  ${helpStyle().dim("URL")}  ${server.url}\n` +
          `  ${helpStyle().dim("Bind")} 127.0.0.1 (loopback only)\n` +
          `  ${helpStyle().dim("Stop")} Ctrl+C\n`,
      );
      if (options.open !== false) {
        await (await import("open")).default(server.url);
      }
      await new Promise<void>((resolve) => process.once("SIGINT", resolve));
      await server.close();
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const account = program
  .command("account")
  .description("Inspect the signed-in account");
account
  .command("show")
  .description("Show your account and visible profile data")
  .action(
    withClient((client) => client.users.getOwnInfo(), { title: "Account" }),
  );
account
  .command("info")
  .description("Show account information")
  .action(
    withClient((client) => client.modules.getAccountInfoPage(), {
      title: "Account information",
    }),
  );
account
  .command("settings")
  .description("Show account settings without changing them")
  .action(
    withClient((client) => client.modules.getAccountSettings(), {
      title: "Account settings",
    }),
  );
account
  .command("logins")
  .description("Show recent login history")
  .action(
    withClient((client) => client.modules.getAccountLogins(), {
      title: "Recent logins",
    }),
  );
const users = program
  .command("users")
  .description("Find visible users and profiles");
users
  .command("search <query>")
  .description("Search the address book")
  .option("--limit <number>", "maximum results", DEFAULT_LIMIT)
  .action(async (query, options) => {
    try {
      print(
        await (await restoreClient()).users.searchAutocomplete(
          query,
          boundedLimit(options.limit),
        ),
        jsonOutput(),
        {
          title: `Users matching “${query}”`,
          empty: "No visible users matched this search.",
        },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
users
  .command("show <username>")
  .description("Show one visible address-book profile")
  .action(async (username) => {
    try {
      print(
        await (await restoreClient()).users.getInfo(username),
        jsonOutput(),
        { title: "User" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
users
  .command("personal")
  .description("Check the personal address book without changing contacts")
  .action(() => readRoute("users.personal", "Personal address book"));
// personal stays on readRoute (no dedicated structured loader yet)

const notifications = program
  .command("notifications")
  .description("Read notification state and counters");
notifications
  .command("list")
  .description(
    "List SSE notification feed items (use badges for unread module counters)",
  )
  .action(
    withClient(
      async (client) => {
        const data = await client.notifications.getAll();
        return {
          ...data,
          note: "This is the notification feed. Unread module counters live under notifications badges.",
        };
      },
      {
        title: "Notifications",
        empty: "You have no notifications in the feed.",
      },
    ),
  );
notifications
  .command("badges")
  .description("Show unread counters for installed modules")
  .action(
    withClient((client) => client.notifications.getBadges(), {
      title: "Badges",
    }),
  );
notifications
  .command("read-all")
  .description("Mark every visible notification as read (requires --confirm)")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(async (options: { confirm?: boolean }) => {
    try {
      requireWriteConfirm(options, "notifications read-all");
      await (await restoreClient()).notifications.readAll();
      printWriteSuccess(
        "Notifications marked as read",
        { read: true },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const calendar = program
  .command("calendar")
  .description("Read calendars and events");
calendar
  .command("upcoming")
  .description("Show upcoming events")
  .action(
    withClient((client) => client.calendar.getUpcomingEvents(), {
      title: "Upcoming events",
      empty: "No upcoming events.",
    }),
  );
calendar
  .command("sources")
  .description("List visible calendars and event sources")
  .action(
    withClient((client) => client.calendar.getEventSources(), {
      title: "Calendar sources",
      empty: "No calendar sources are available.",
    }),
  );
calendar
  .command("events")
  .description("List events inside an ISO date range")
  .requiredOption("--start <iso>")
  .requiredOption("--end <iso>")
  .action(async (options) => {
    try {
      print(
        await (await restoreClient()).calendar.getEvents(
          options.start,
          options.end,
        ),
        jsonOutput(),
        { title: "Calendar events", empty: "No events in this range." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
calendar
  .command("show")
  .description("Show upcoming calendar overview")
  .action(
    withClient((client) => client.calendar.getUpcomingEvents(), {
      title: "Calendar",
      empty: "No upcoming events.",
    }),
  );
calendar
  .command("holidays")
  .description("Show school holiday countdown (Ferien & Feiertage)")
  .option("--next", "list the next free days instead of season overview")
  .option("--limit <number>", "maximum entries for --next", DEFAULT_LIMIT)
  .action(async (options: { next?: boolean; limit: string }) => {
    try {
      const overview = await (await restoreClient()).calendar.getHolidays({
        nextLimit: boundedLimit(options.limit, 50),
      });
      print(
        { ...overview, mode: options.next ? "next" : "seasons" },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
calendar
  .command("plugin <name>")
  .description("Read events from a calendar plugin (e.g. holiday, exam-plan)")
  .requiredOption("--start <iso>", "range start YYYY-MM-DD")
  .requiredOption("--end <iso>", "range end YYYY-MM-DD")
  .action(async (name: string, options: { start: string; end: string }) => {
    try {
      print(
        await (await restoreClient()).calendar.getPluginEvents(
          name,
          options.start,
          options.end,
        ),
        jsonOutput(),
        { title: `Plugin · ${name}`, empty: "No plugin events in this range." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
calendar
  .command("search <query>")
  .description("Search visible events in an ISO date range")
  .requiredOption("--start <iso>")
  .requiredOption("--end <iso>")
  .action(async (query, options) => {
    try {
      print(
        await (await restoreClient()).calendar.searchEvents(
          query,
          options.start,
          options.end,
        ),
        jsonOutput(),
        { title: `Calendar matching “${query}”`, empty: "No matching events." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
calendar
  .command("create")
  .description("Create a calendar event (requires --confirm)")
  .requiredOption("--subject <subject>")
  .requiredOption("--calendar <id>", "calendar source id from calendar sources")
  .requiredOption("--start <iso>")
  .requiredOption("--end <iso>")
  .option("--location <text>")
  .option("--description <text>")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(
    async (options: {
      subject: string;
      calendar: string;
      start: string;
      end: string;
      location?: string;
      description?: string;
      confirm?: boolean;
    }) => {
      try {
        requireWriteConfirm(options, "calendar create");
        const result = await (await restoreClient()).calendar.createEvent({
          subject: options.subject,
          calendar: options.calendar,
          start: options.start,
          end: options.end,
          ...(options.location ? { location: options.location } : {}),
          ...(options.description ? { description: options.description } : {}),
        });
        printWriteSuccess(
          "Event created",
          { created: true, result },
          jsonOutput(),
        );
      } catch (error) {
        fail(error, jsonOutput());
      }
    },
  );
calendar
  .command("delete")
  .description("Delete a calendar event (requires --confirm)")
  .requiredOption("--uid <uid>")
  .requiredOption("--hash <hash>")
  .requiredOption("--calendar <id>")
  .requiredOption("--start <iso>")
  .option("--series", "delete the whole series")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(
    async (options: {
      uid: string;
      hash: string;
      calendar: string;
      start: string;
      series?: boolean;
      confirm?: boolean;
    }) => {
      try {
        requireWriteConfirm(options, "calendar delete");
        const result = await (await restoreClient()).calendar.deleteEvent({
          uid: options.uid,
          hash: options.hash,
          calendar: options.calendar,
          start: options.start,
          ...(options.series ? { series: true } : {}),
        });
        printWriteSuccess(
          "Event deleted",
          { deleted: true, result },
          jsonOutput(),
        );
      } catch (error) {
        fail(error, jsonOutput());
      }
    },
  );

const files = program
  .command("files")
  .description("Inspect storage and file metadata");
files
  .command("show")
  .alias("overview")
  .description("Show the files module overview (not quota)")
  .action(() => readRoute("files.overview", "Files"));
files
  .command("quota")
  .description("Show storage use and quota")
  .action(
    withClient((client) => client.files.getDiskSpace(), { title: "Storage" }),
  );
files
  .command("size <path>")
  .description("Calculate the size of an accessible remote folder")
  .action(async (path) => {
    try {
      print(
        await (await restoreClient()).files.getFolderSize(path),
        jsonOutput(),
        { title: "Folder size" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const mail = program.command("mail").description("Read and send account email");
mail
  .command("list")
  .description(
    "List inbox metadata (pages ~200/server; use --offset to continue; max 1000)",
  )
  .option(
    "--limit <number>",
    "maximum messages (1-1000; server pages ~200)",
    DEFAULT_LIMIT,
  )
  .option("--offset <number>", "skip this many newest messages", "0")
  .action(async (options: { limit: string; offset: string }) => {
    try {
      await ensureConfig();
      const offset = Number(options.offset);
      if (!Number.isInteger(offset) || offset < 0) {
        throw new Error("--offset must be a non-negative integer");
      }
      print(
        await (await restoreClient()).email.getEmails({
          limit: boundedLimit(options.limit, 1000),
          offset,
        }),
        jsonOutput(),
        { title: "Inbox", empty: "No messages in this mailbox." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
mail
  .command("status")
  .description("Show inbox totals and unread count (not a full message list)")
  .action(async () => {
    try {
      const page = await (await restoreClient()).email.getEmails({ limit: 1 });
      const unreadSample = await (await restoreClient()).email.getEmails({
        limit: 50,
      });
      const unread = unreadSample.items.filter((item) => !item.read).length;
      print(
        {
          title: "Mail status",
          mailbox: "INBOX",
          total: page.total,
          all: page.all,
          unreadAtLeast: unread,
          note:
            unreadSample.items.length < unreadSample.total
              ? "unreadAtLeast is based on the newest 50 messages; use mail list for the full inbox."
              : undefined,
        },
        jsonOutput(),
        { title: "Mail status" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
mail
  .command("show <uid>")
  .description("Show one message by UID")
  .option("--mailbox <name>", "mailbox", "INBOX")
  .action(async (uid, options) => {
    try {
      print(
        await (await restoreClient()).email.getMessage(
          Number(uid),
          options.mailbox,
        ),
        jsonOutput(),
        { title: `Message ${uid}` },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
mail
  .command("send")
  .description("Send an email (requires --confirm)")
  .requiredOption(
    "--to <address>",
    "recipient (repeatable or comma-separated)",
    collectOption,
  )
  .option(
    "--cc <address>",
    "CC recipient (repeatable or comma-separated)",
    collectOption,
  )
  .option(
    "--bcc <address>",
    "BCC recipient (repeatable or comma-separated)",
    collectOption,
  )
  .requiredOption("--subject <subject>")
  .requiredOption("--body <body>")
  .option(
    "--idempotency-key <key>",
    "stable key so retries do not double-send (auto-generated if omitted)",
  )
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(
    async (options: {
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      body: string;
      idempotencyKey?: string;
      confirm?: boolean;
    }) => {
      try {
        requireWriteConfirm(options, "mail send");
        await ensureConfig();
        const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);
        if (
          (await claimIdempotencyKey("mail send", idempotencyKey)) ===
          "completed"
        ) {
          printWriteSuccess(
            "Email already sent",
            { sent: true, deduped: true, idempotencyKey },
            jsonOutput(),
          );
          return;
        }
        await (await restoreClient()).email.sendEmail({
          to: options.to,
          ...(options.cc?.length ? { cc: options.cc } : {}),
          ...(options.bcc?.length ? { bcc: options.bcc } : {}),
          subject: options.subject,
          body: options.body,
          idempotencyKey,
        });
        await completeIdempotencyKey("mail send", idempotencyKey);
        printWriteSuccess(
          "Email sent",
          {
            sent: true,
            idempotencyKey,
            to: options.to,
            ...(options.cc?.length ? { cc: options.cc } : {}),
            ...(options.bcc?.length ? { bcc: options.bcc } : {}),
          },
          jsonOutput(),
        );
      } catch (error) {
        fail(error, jsonOutput());
      }
    },
  );

const messenger = program
  .command("messenger")
  .description("Read and send Matrix messages");
messenger
  .command("rooms")
  .description("List joined rooms")
  .action(
    withMessengerClient(
      async (client) => {
        const rooms = await client.messenger.getRooms();
        return {
          title: "Messenger rooms",
          empty: rooms.length === 0,
          items: rooms,
          ...(rooms.length === 0 ? { message: "No joined rooms." } : {}),
        };
      },
      {
        title: "Messenger rooms",
        empty: "No joined rooms.",
      },
    ),
  );
messenger
  .command("sync")
  .description("Run a one-shot Matrix sync and list joined rooms")
  .action(
    withMessengerClient(
      async (client) => {
        const rooms = await client.messenger.getRooms();
        return {
          title: "Messenger sync",
          empty: rooms.length === 0,
          items: rooms,
          note: "One-shot /sync filtered to joined rooms (same source as messenger rooms).",
        };
      },
      {
        title: "Messenger sync",
        empty: "No joined rooms.",
      },
    ),
  );
messenger
  .command("contacts")
  .description("List DM contacts with resolved display names")
  .action(async () => {
    try {
      const contacts = await (
        await restoreMessengerClient()
      ).messenger.getContacts();
      if (jsonOutput()) {
        print(contacts, true);
        return;
      }
      if (contacts.length === 0) {
        print([], false, {
          title: "Messenger contacts",
          empty: "No direct-message contacts.",
        });
        return;
      }
      const lines = [
        "Messenger contacts",
        ...contacts.map((contact) =>
          contact.note
            ? `  ${contact.name} (${contact.shortId}) – ${contact.note}`
            : `  ${contact.name} (${contact.shortId})`,
        ),
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("messages <roomId>")
  .description("List a bounded page of room messages")
  .option("--limit <number>", "maximum messages", DEFAULT_LIMIT)
  .action(async (roomId, options) => {
    try {
      print(
        await (await restoreMessengerClient()).messenger.getMessages(roomId, {
          limit: boundedLimit(options.limit),
        }),
        jsonOutput(),
        { title: "Messages", empty: "No messages in this page." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("send <room>")
  .description(
    "Send a room message (requires --confirm). Room may be a Matrix id (!…) or unique room name.",
  )
  .option("--body <body>", "message body")
  .option("--text <text>", "alias for --body")
  .option(
    "--idempotency-key <key>",
    "Matrix txn id so retries do not double-send (auto-generated if omitted)",
  )
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(
    async (
      room: string,
      options: {
        body?: string;
        text?: string;
        idempotencyKey?: string;
        confirm?: boolean;
      },
    ) => {
      try {
        requireWriteConfirm(options, "messenger send");
        await ensureConfig();
        const body = options.body ?? options.text;
        if (!body) {
          throw new Error(
            "Provide --body <text> (or --text). Pass a room id (!…) or unique room name.",
          );
        }
        const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);
        if (
          (await claimIdempotencyKey("messenger send", idempotencyKey)) ===
          "completed"
        ) {
          printWriteSuccess(
            "Message already sent",
            { sent: true, deduped: true, idempotencyKey },
            jsonOutput(),
          );
          return;
        }
        const client = await restoreMessengerClient();
        const result = room.startsWith("!")
          ? await client.messenger.sendMessage(room, body, idempotencyKey)
          : await client.messenger.sendMessageByName(
              room,
              body,
              idempotencyKey,
            );
        await completeIdempotencyKey("messenger send", idempotencyKey);
        printWriteSuccess(
          "Message sent",
          { sent: true, idempotencyKey, result },
          jsonOutput(),
        );
      } catch (error) {
        fail(error, jsonOutput());
      }
    },
  );
messenger
  .command("delete <roomId> <eventId>")
  .description("Delete a message (requires --confirm)")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(async (roomId, eventId, options: { confirm?: boolean }) => {
    try {
      requireWriteConfirm(options, "messenger delete");
      const result = await (
        await restoreMessengerClient()
      ).messenger.deleteMessage(roomId, eventId);
      printWriteSuccess(
        "Message deleted",
        { deleted: true, result },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("leave <roomId>")
  .description("Leave a room (requires --confirm)")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(async (roomId, options: { confirm?: boolean }) => {
    try {
      requireWriteConfirm(options, "messenger leave");
      await (await restoreMessengerClient()).messenger.leaveRoom(roomId);
      printWriteSuccess("Room left", { left: true, roomId }, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("react <roomId> <eventId>")
  .description("React to a message with an emoji (requires --confirm)")
  .requiredOption("--emoji <emoji>", "reaction emoji, e.g. 👍")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(
    async (
      roomId: string,
      eventId: string,
      options: { emoji: string; confirm?: boolean },
    ) => {
      try {
        requireWriteConfirm(options, "messenger react");
        const result = await (
          await restoreMessengerClient()
        ).messenger.reactToMessage(roomId, eventId, options.emoji);
        printWriteSuccess(
          "Reaction sent",
          { sent: true, result },
          jsonOutput(),
        );
      } catch (error) {
        fail(error, jsonOutput());
      }
    },
  );
messenger
  .command("members <roomId>")
  .description("List members of a joined room")
  .action(async (roomId: string) => {
    try {
      print(
        await (await restoreMessengerClient()).messenger.getMembers(roomId),
        jsonOutput(),
        { title: "Room members", empty: "No visible room members." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("profile <userId>")
  .description("Show a visible Matrix profile")
  .action(async (userId: string) => {
    try {
      print(
        await (await restoreMessengerClient()).messenger.getProfile(userId),
        jsonOutput(),
        { title: "Messenger profile" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("status")
  .description("List joined rooms (messenger status)")
  .action(
    withMessengerClient((client) => client.messenger.getRooms(), {
      title: "Messenger",
      empty: "No joined rooms.",
    }),
  );
program
  .command("conference")
  .description("Inspect videoconference availability")
  .command("health")
  .description("Show conference service health")
  .action(
    withClient((client) => client.conference.getHealth(), {
      title: "Conference",
    }),
  );

const exercises = program
  .command("exercises")
  .description("List current and past exercises");
exercises
  .command("list")
  .description("List current exercises")
  .option("--search <query>", "optional server-side search")
  .action(async (options: { search?: string }) => {
    try {
      print(
        await (await restoreClient()).modules.listExercises(
          options.search ? { search: options.search } : {},
        ),
        jsonOutput(),
        { title: "Current exercises", empty: "No current exercises." },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
exercises
  .command("past")
  .description("List past exercises")
  .action(
    withClient((client) => client.modules.listPastExercises(), {
      title: "Past exercises",
      empty: "No past exercises.",
      maxRows: 100,
    }),
  );

const timetable = program
  .command("timetable")
  .description("Show your personal timetable");
timetable
  .command("show")
  .description("Show this week's personal timetable as a grid")
  .option("--start <date>", "range start as DD.MM.YYYY or YYYY-MM-DD")
  .option(
    "--end <date>",
    "range end as DD.MM.YYYY or YYYY-MM-DD (default: start week Fri)",
  )
  .action(async (options: { start?: string; end?: string }) => {
    try {
      print(
        await (await restoreClient()).timetable.getWeek({
          ...(options.start ? { startDate: options.start } : {}),
          ...(options.end ? { endDate: options.end } : {}),
        }),
        jsonOutput(),
        { title: "Timetable", maxRows: 20 },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
timetable
  .command("today")
  .description("Show today's personal timetable (period list)")
  .option("--date <date>", "day as DD.MM.YYYY or YYYY-MM-DD (default: today)")
  .action(async (options: { date?: string }) => {
    try {
      print(
        await (await restoreClient()).timetable.getToday(
          options.date ? { date: options.date } : {},
        ),
        jsonOutput(),
        { title: "Timetable today", maxRows: 20 },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

program
  .command("polls")
  .description("List polls visible to the account")
  .command("list")
  .description("List active polls")
  .action(
    withClient((client) => client.modules.listPolls(), {
      title: "Polls",
      empty: "No polls available.",
    }),
  );

program
  .command("forums")
  .description("List forums without changing read state")
  .command("list")
  .description("List forums")
  .action(
    withClient((client) => client.modules.listForums(), {
      title: "Forums",
      empty: "No forums found.",
    }),
  );

const news = program.command("news").description("List and show news");
news
  .command("list")
  .description("List news entries")
  .option("--search <query>", "optional server-side search")
  .option("--limit <number>", "maximum entries", "25")
  .action(async (options: { search?: string; limit: string }) => {
    try {
      print(
        await (await restoreClient()).modules.listNews({
          ...(options.search ? { search: options.search } : {}),
          limit: boundedLimit(options.limit, 100),
        }),
        jsonOutput(),
        { title: "News", empty: "No news entries.", maxRows: 40 },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
news
  .command("show <id>")
  .description("Show one news entry by ID")
  .action(async (id: string) => {
    try {
      print(await (await restoreClient()).modules.showNews(id), jsonOutput(), {
        title: "News entry",
      });
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

program
  .command("courses")
  .description("List course selections")
  .command("list")
  .description("List available course selections")
  .action(
    withClient((client) => client.modules.listCourseSelections(), {
      title: "Course selections",
      empty: "No open course selections.",
    }),
  );

program
  .command("mailing-lists")
  .description("List mailing lists without changing them")
  .command("list")
  .description("List visible mailing lists")
  .action(
    withClient((client) => client.modules.listMailingLists(), {
      title: "Mailing lists",
      empty: "No mailing lists found.",
    }),
  );

program
  .command("print")
  .description("Inspect printing without uploading or deleting files")
  .command("show")
  .alias("quota")
  .description("Show print-job status")
  .action(
    withClient((client) => client.modules.listPrintJobs(), {
      title: "Printing",
      empty: "No print jobs queued.",
    }),
  );

program
  .command("etherpads")
  .description("List collaborative pads without editing them")
  .command("list")
  .description("List visible Etherpads")
  .action(
    withClient((client) => client.modules.listEtherpads(), {
      title: "Etherpads",
      empty: "No etherpads found.",
    }),
  );

program
  .command("groups")
  .description("List groups")
  .command("list")
  .description("List visible groups without joining or leaving")
  .action(
    withClient((client) => client.modules.listGroups(), {
      title: "Groups",
      empty: "No groups found.",
    }),
  );

program
  .command("help")
  .description("Inspect instance-provided help")
  .command("show")
  .description("List help documentation links")
  .action(
    withClient((client) => client.modules.getHelpOverview(), {
      title: "Help",
    }),
  );

program
  .command("office")
  .description("Inspect office integration")
  .command("show")
  .description("Show office actions")
  .action(
    withClient((client) => client.modules.getOfficeInfo(), {
      title: "Office",
    }),
  );

program
  .command("app")
  .description("Inspect application information")
  .command("legal")
  .description("Check app legal information")
  .action(() => readRoute("app.legal", "App information"));

program
  .command("whatsnew")
  .description("Show recent CLI changelog entries")
  .option("--limit <number>", "how many sections to show", "3")
  .action(async (options: { limit: string }) => {
    try {
      const changelogPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "CHANGELOG.md",
      );
      const text = await readFile(changelogPath, "utf8");
      const limit = boundedLimit(options.limit, 20);
      const sections = text
        .split(/\n(?=## )/)
        .filter((section) => section.startsWith("## "));
      const selected = sections.slice(0, limit).join("\n").trim();
      if (jsonOutput()) {
        print(
          {
            version: CLI_VERSION,
            entries: sections.slice(0, limit).map((section) => {
              const [title, ...rest] = section.split("\n");
              return {
                heading: (title ?? "").replace(/^##\s*/, "").trim(),
                body: rest.join("\n").trim(),
              };
            }),
          },
          true,
        );
        return;
      }
      process.stdout.write(`${selected}\n`);
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

program
  .command("doctor")
  .description("Diagnose config, auth, and basic connectivity")
  .action(async () => {
    try {
      await ensureConfig();
      const directory = await configDirectory();
      const { ProfileStore } = await api();
      const store = new ProfileStore(directory);
      const profiles = await store.read();
      const checks: Array<Record<string, unknown>> = [
        {
          check: "configDirectory",
          ok: true,
          path: directory,
          portable: process.env.ISERV_PORTABLE === "1",
        },
        {
          check: "timeout",
          ok: true,
          timeoutMs: Number(process.env.ISERV_TIMEOUT_MS ?? 30_000),
        },
        {
          check: "defaultLimit",
          ok: true,
          defaultLimit: runtimeConfig.defaultLimit,
        },
        {
          check: "profiles",
          ok: true,
          count: profiles.profiles.length,
          activeProfile: profiles.activeProfile,
        },
      ];
      try {
        const status = await (await broker()).status();
        checks.push({
          check: "auth",
          ok: status.authenticated,
          profile: status.profile,
          authenticated: status.authenticated,
          capabilitiesVerified: status.capabilitiesVerified ?? false,
        });
      } catch (error) {
        checks.push({
          check: "auth",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const catalogSize = (await catalog()).routeCatalog.routes.length;
      const cliCommands = program.commands.filter(
        (sub) => !(sub as Command & { _hidden?: boolean })._hidden,
      ).length;
      checks.push({
        check: "catalogCoverage",
        ok: true,
        routes: catalogSize,
        topLevelCommands: cliCommands,
        note: "Many routes are reachable via `iserv routes probe` without a dedicated wrapper.",
      });
      print(
        {
          title: "Doctor",
          version: CLI_VERSION,
          ok: checks.every((item) => item.ok !== false),
          checks,
        },
        jsonOutput(),
        { title: "Doctor" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const configCmd = program
  .command("config")
  .description("Show or set local CLI defaults (timeout, limit, host)");
configCmd
  .command("show")
  .description("Show merged config (file + .iserv.json + defaults)")
  .action(async () => {
    try {
      await ensureConfig();
      print(
        {
          directory: await configDirectory(),
          config: runtimeConfig,
          env: {
            ISERV_TIMEOUT_MS: process.env.ISERV_TIMEOUT_MS ?? null,
            ISERV_HOST: process.env.ISERV_HOST ?? null,
            ISERV_PORTABLE: process.env.ISERV_PORTABLE ?? null,
          },
        },
        jsonOutput(),
        { title: "Config" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
configCmd
  .command("set <assignment>")
  .description("Set a config value, e.g. timeoutSeconds=60 or defaultLimit=25")
  .action(async (assignment: string) => {
    try {
      await ensureConfig();
      const match = assignment.match(
        /^(timeoutSeconds|defaultLimit|host|profile)=(.*)$/,
      );
      if (!match) {
        throw new Error(
          "Use timeoutSeconds=<n>, defaultLimit=<n>, host=<hostname>, or profile=<name>",
        );
      }
      const [, key, raw = ""] = match;
      const directory = await configDirectory();
      const current = await loadCliConfig(directory);
      if (key === "timeoutSeconds" || key === "defaultLimit") {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`${key} must be a positive integer`);
        }
        current[key] = value;
      } else if (key === "host" || key === "profile") {
        current[key] = raw;
      }
      const path = await saveCliConfig(directory, current);
      runtimeConfig = mergeConfig(current, await loadProjectConfig());
      printWriteSuccess(
        "Config updated",
        { path, config: current },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

program
  .command("completion <shell>")
  .description("Print a bash or zsh completion script")
  .action((shell: string) => {
    try {
      const names = program.commands
        .filter((sub) => !(sub as Command & { _hidden?: boolean })._hidden)
        .map((sub) => sub.name())
        .sort()
        .join(" ");
      if (shell === "bash") {
        process.stdout.write(`# iserv bash completion
_iserv_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${names} --help --json --debug --verbose --timeout --portable --version" -- "$cur") )
  fi
}
complete -F _iserv_completions iserv
`);
        return;
      }
      if (shell === "zsh") {
        process.stdout.write(`# iserv zsh completion
#compdef iserv
_iserv() {
  local -a commands
  commands=(${names
    .split(" ")
    .map((name) => `${name}:'iserv ${name}'`)
    .join(" ")})
  _arguments '1:command:->cmds' '*::arg:->args'
  case $state in
    cmds) _describe 'command' commands ;;
  esac
}
compdef _iserv iserv
`);
        return;
      }
      throw new Error("Supported shells: bash, zsh");
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

registerUnavailableModule(
  "education",
  "Education connector (not available in this CLI)",
  "the module leaves the IServ origin via a cross-origin redirect",
);
registerUnavailableModule(
  "excalidraw",
  "Excalidraw connector (not available in this CLI)",
  "the module leaves the IServ origin via a cross-origin redirect",
);
registerUnavailableModule(
  "pinboard",
  "Pinboard module (not available in this CLI)",
  "no reliable same-origin read contract for this account/module",
);

program.hook("preAction", async () => {
  applyGlobalFlags();
  await ensureConfig();
});

const patchHelpForJson = (cmd: Command): void => {
  const original = cmd.outputHelp.bind(cmd);
  cmd.outputHelp = ((...args: Parameters<Command["outputHelp"]>) => {
    applyGlobalFlags();
    if (jsonOutput()) {
      const isRoot = cmd.name() === "iserv";
      emitHelpJson({
        name: isRoot ? CLI_NAME : `iserv ${cmd.name()}`,
        version: CLI_VERSION,
        description: cmd.description(),
        options: (isRoot
          ? cmd.options
          : [...program.options, ...cmd.options]
        ).map((option) => ({
          flags: option.flags,
          description: option.description,
        })),
        commands: cmd.commands
          .filter((sub) => !(sub as Command & { _hidden?: boolean })._hidden)
          .map((sub) => ({
            name: sub.name(),
            description: sub.description(),
            ...(sub.aliases().length > 0 ? { aliases: sub.aliases() } : {}),
          })),
      });
      return;
    }
    return original(...args);
  }) as Command["outputHelp"];
  for (const sub of cmd.commands) patchHelpForJson(sub);
};
patchHelpForJson(program);

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CommanderExit) return;
  if (error instanceof CommanderError) {
    // Help already printed by Commander (plaintext or JSON); keep exit 0 for help.
    process.exitCode =
      error.exitCode === 0 ||
      error.code === "commander.help" ||
      error.code === "commander.helpDisplayed"
        ? 0
        : (error.exitCode ?? 1);
    return;
  }
  try {
    fail(error, jsonOutput());
  } catch (exitError) {
    if (!(exitError instanceof CommanderExit)) throw exitError;
  }
});
