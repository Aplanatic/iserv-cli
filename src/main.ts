import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IServClient } from "@aplanatic/iserv-api";
import { Command, CommanderError, Option } from "commander";
import {
  CommanderExit,
  fail,
  type PrintOptions,
  print,
  printAuthStatus,
  printProfiles,
  printReadRoute,
  printRoute,
  printRoutes,
  printRouteTree,
  printSuccess,
  uiStyle,
} from "./output.js";
import { parseParameters } from "./parameters.js";

const program = new Command();
const helpStyle = uiStyle();
program
  .name("iserv")
  .description("A calm, secure command line for your IServ account")
  .version("0.6.8")
  .showSuggestionAfterError()
  .showHelpAfterError("Run with --help to see available commands.")
  .exitOverride()
  .configureHelp({
    sortOptions: true,
    sortSubcommands: true,
    styleTitle: (value) => helpStyle.bold(value),
    styleCommandText: (value) => helpStyle.cyan(value),
    styleOptionText: (value) => helpStyle.cyan(value),
    styleArgumentText: (value) => helpStyle.yellow(value),
    styleSubcommandText: (value) => helpStyle.cyan(value),
  });
program
  .option("--json", "emit stable machine-readable JSON")
  .addHelpText(
    "after",
    `\n${helpStyle.bold("Start here")}\n  ${helpStyle.cyan("iserv auth login --url <your-instance>")}\n  ${helpStyle.cyan("iserv auth status")}\n  ${helpStyle.cyan("iserv routes tree")}\n`,
  );

const jsonOutput = () => Boolean(program.opts().json);
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
  .requiredOption("--url <url>", "custom IServ instance URL")
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
  .addHelpText(
    "after",
    `\n${helpStyle.bold("Examples")}\n  ${helpStyle.cyan("iserv auth login --url iserv.example")}\n  ${helpStyle.cyan("iserv auth login --url iserv.example --browser")}\n`,
  )
  .action(async (options) => {
    try {
      const { input, password } = await import("@inquirer/prompts");
      const username =
        options.username ?? (await input({ message: "Account name" }));
      const authBroker = await broker();
      if (options.browser) {
        await authBroker.loginBrowser({
          profile: options.profile,
          url: options.url,
          username,
          allowPrivateHost: options.allowPrivateHost,
        });
      } else {
        const secret = await password({ message: "Password", mask: "•" });
        await authBroker.login({
          profile: options.profile,
          url: options.url,
          username,
          password: secret,
          allowPrivateHost: options.allowPrivateHost,
          challengeHandler: async (challenge) =>
            password({ message: challenge.prompt, mask: "•" }),
        });
      }
      printSuccess(
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
      printSuccess("Logged out", { loggedOut: true }, jsonOutput());
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
      printSuccess(
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
      await authBroker.profiles.remove(String(name));
      printSuccess("Profile removed", { removed: name }, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const routes = program
  .command("routes")
  .description("Inspect and safely probe the route catalog")
  .addHelpText(
    "after",
    `\n${helpStyle.bold("Examples")}\n  ${helpStyle.cyan("iserv routes tree")}\n  ${helpStyle.cyan("iserv routes search calendar")}\n  ${helpStyle.cyan("iserv routes show calendar.upcoming")}\n`,
  );
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
  .option("--limit <number>", "maximum results per source (1-50)", "10")
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
  .description("Open the local interactive route explorer")
  .action(async () => {
    try {
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
      const server = await (await api()).startExplorerServer(
        client ? { client, assetsDirectory } : { assetsDirectory },
      );
      process.stdout.write(
        `${helpStyle.green("●")} ${helpStyle.bold("Explorer ready")}\n` +
          `  ${helpStyle.dim("URL")}  ${server.url}\n` +
          `  ${helpStyle.dim("Stop")} Ctrl+C\n`,
      );
      await (await import("open")).default(server.url);
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
  .option("--limit <number>", "maximum results", "20")
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
      printSuccess(
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
  .option("--limit <number>", "maximum entries for --next", "12")
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
        printSuccess("Event created", { created: true, result }, jsonOutput());
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
        printSuccess("Event deleted", { deleted: true, result }, jsonOutput());
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
    "List bounded message metadata from the inbox (pages past the ~200/server page; max 1000)",
  )
  .option(
    "--limit <number>",
    "maximum messages (1-1000; warns if fewer returned)",
    "20",
  )
  .action(async (options) => {
    try {
      print(
        await (await restoreClient()).email.getEmails({
          limit: boundedLimit(options.limit, 1000),
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
  .requiredOption("--to <address>")
  .requiredOption("--subject <subject>")
  .requiredOption("--body <body>")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(async (options) => {
    try {
      requireWriteConfirm(options, "mail send");
      await (await restoreClient()).email.sendEmail({
        to: options.to,
        subject: options.subject,
        body: options.body,
      });
      printSuccess("Email sent", { sent: true }, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

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
  .option("--limit <number>", "maximum messages", "20")
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
  .command("send <roomId>")
  .description(
    "Send a room message (requires --confirm). Example: iserv messenger send '!abc:host' --body 'hi'",
  )
  .option("--body <body>", "message body")
  .option("--text <text>", "alias for --body")
  .option(
    "--confirm",
    "required acknowledgement that this writes to the server",
  )
  .action(
    async (
      roomId,
      options: { body?: string; text?: string; confirm?: boolean },
    ) => {
      try {
        requireWriteConfirm(options, "messenger send");
        const body = options.body ?? options.text;
        if (!body) {
          throw new Error(
            "Provide --body <text> (or --text). Room id is the positional argument, not --room.",
          );
        }
        const result = await (
          await restoreMessengerClient()
        ).messenger.sendMessage(roomId, body);
        printSuccess("Message sent", result, jsonOutput());
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
      printSuccess("Message deleted", result, jsonOutput());
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
      printSuccess("Room left", { left: true, roomId }, jsonOutput());
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
        printSuccess("Reaction sent", result, jsonOutput());
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
  .option("--start <date>", "week start as DD.MM.YYYY or YYYY-MM-DD")
  .action(async (options: { start?: string }) => {
    try {
      print(
        await (await restoreClient()).timetable.getWeek(
          options.start ? { startDate: options.start } : {},
        ),
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

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CommanderExit) return;
  if (error instanceof CommanderError) {
    // Help/version already printed by Commander; keep their exit codes (0).
    process.exitCode =
      error.exitCode === 0 ||
      error.code === "commander.help" ||
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version"
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
