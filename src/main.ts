import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthBroker,
  type IServClient,
  ProfileStore,
  routeCatalog,
  startExplorerServer,
} from "@aplanatic/iserv-api";
import { input, password } from "@inquirer/prompts";
import { Command, Option } from "commander";
import open from "open";
import {
  CommanderExit,
  fail,
  type PrintOptions,
  print,
  printAuthStatus,
  printProfiles,
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
  .version("0.2.0")
  .showSuggestionAfterError()
  .showHelpAfterError("Run with --help to see available commands.")
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
const broker = () => new AuthBroker();
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
) => run(async () => action(await broker().restore()), options);

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
      const username =
        options.username ?? (await input({ message: "Account name" }));
      const authBroker = broker();
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
      printAuthStatus(await broker().status(options.profile), jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
auth
  .command("logout")
  .description("End the remote session and remove it from the keychain")
  .option("--profile <name>")
  .action(async (options: { profile?: string }) => {
    try {
      await broker().logout(options.profile);
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
  .description("Log out and remove a saved profile")
  .action(async (name?: string) => {
    try {
      const authBroker = broker();
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
  .action(() => printRouteTree(routeCatalog.tree(), jsonOutput()));
routes
  .command("search <query>")
  .description("Find routes by ID, module, path, or description")
  .action((query) =>
    printRoutes(routeCatalog.search(query), query, jsonOutput()),
  );
routes
  .command("show <routeId>")
  .description("Show the contract and provenance for one route")
  .action((routeId) => {
    try {
      printRoute(routeCatalog.get(routeId), jsonOutput());
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
      print(
        await (await broker().restore()).executeReadRoute(
          routeId,
          parseParameters(options.param),
        ),
        jsonOutput(),
        { title: `Probe · ${routeId}` },
      );
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
        client = await broker().restore();
      } catch {
        /* Documentation-only mode. */
      }
      const server = await startExplorerServer(
        client ? { client, assetsDirectory } : { assetsDirectory },
      );
      process.stdout.write(
        `${helpStyle.green("●")} ${helpStyle.bold("Explorer ready")}\n` +
          `  ${helpStyle.dim("URL")}  ${server.url}\n` +
          `  ${helpStyle.dim("Stop")} Ctrl+C\n`,
      );
      await open(server.url);
      await new Promise<void>((resolve) => process.once("SIGINT", resolve));
      await server.close();
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

program
  .command("account")
  .description("Inspect the signed-in account")
  .command("show")
  .description("Show your account and visible profile data")
  .action(
    withClient((client) => client.users.getOwnInfo(), { title: "Account" }),
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
        await (await broker().restore()).users.searchAutocomplete(
          query,
          Number(options.limit),
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
        await (await broker().restore()).users.getInfo(username),
        jsonOutput(),
        { title: "User" },
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const notifications = program
  .command("notifications")
  .description("Read notification state and counters");
notifications
  .command("list")
  .description("List visible notifications")
  .action(
    withClient((client) => client.notifications.getAll(), {
      title: "Notifications",
      empty: "You have no notifications.",
    }),
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
  .description("Mark every visible notification as read")
  .action(async () => {
    try {
      await (await broker().restore()).notifications.readAll();
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
        await (await broker().restore()).calendar.getEvents(
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

const files = program
  .command("files")
  .description("Inspect storage and file metadata");
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
        await (await broker().restore()).files.getFolderSize(path),
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
  .description("List bounded message metadata from the inbox")
  .option("--limit <number>", "maximum messages", "20")
  .action(async (options) => {
    try {
      print(
        await (await broker().restore()).email.getEmails({
          limit: Number(options.limit),
        }),
        jsonOutput(),
        { title: "Inbox", empty: "No messages in this mailbox." },
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
        await (await broker().restore()).email.getMessage(
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
  .description("Send an email immediately")
  .requiredOption("--to <address>")
  .requiredOption("--subject <subject>")
  .requiredOption("--body <body>")
  .action(async (options) => {
    try {
      await (await broker().restore()).email.sendEmail({
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
    withClient((client) => client.messenger.getRooms(), {
      title: "Messenger rooms",
      empty: "No joined rooms.",
    }),
  );
messenger
  .command("messages <roomId>")
  .description("List a bounded page of room messages")
  .option("--limit <number>", "maximum messages", "20")
  .action(async (roomId, options) => {
    try {
      print(
        await (await broker().restore()).messenger.getMessages(roomId, {
          limit: Number(options.limit),
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
  .description("Send a room message immediately")
  .requiredOption("--body <body>")
  .action(async (roomId, options) => {
    try {
      const result = await (await broker().restore()).messenger.sendMessage(
        roomId,
        options.body,
      );
      printSuccess("Message sent", result, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("delete <roomId> <eventId>")
  .description("Delete a message immediately")
  .action(async (roomId, eventId) => {
    try {
      const result = await (await broker().restore()).messenger.deleteMessage(
        roomId,
        eventId,
      );
      printSuccess("Message deleted", result, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("leave <roomId>")
  .description("Leave a room immediately")
  .action(async (roomId) => {
    try {
      await (await broker().restore()).messenger.leaveRoom(roomId);
      printSuccess("Room left", { left: true, roomId }, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
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

program.parseAsync().catch((error) => {
  if (!(error instanceof CommanderExit)) fail(error, jsonOutput());
});
