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
import { CommanderExit, fail, print } from "./output.js";
import { parseParameters } from "./parameters.js";

const program = new Command();
program
  .name("iserv")
  .description("Normal-user CLI for IServ school servers")
  .version("0.1.0");
program.option("--json", "emit compact JSON");

const jsonOutput = () => Boolean(program.opts().json);
const broker = () => new AuthBroker();
const run =
  <T extends unknown[]>(action: (...args: T) => Promise<unknown>) =>
  async (...args: T) => {
    try {
      const result = await action(...args);
      if (result !== undefined) print(result, jsonOutput());
    } catch (error) {
      if (error instanceof CommanderExit) return;
      fail(error, jsonOutput());
    }
  };
const withClient = (action: (client: IServClient) => Promise<unknown>) =>
  run(async () => action(await broker().restore()));

const auth = program
  .command("auth")
  .description("Authenticate and manage the active session");
auth
  .command("login")
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
  .action(async (options) => {
    try {
      const username =
        options.username ?? (await input({ message: "Account" }));
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
      print(
        { profile: options.profile, username, authenticated: true },
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
auth
  .command("status")
  .option("--profile <name>")
  .action(
    run(async (options: { profile?: string }) => {
      return broker().status(options.profile);
    }),
  );
auth
  .command("logout")
  .option("--profile <name>")
  .action(
    run(async (options: { profile?: string }) => {
      await broker().logout(options.profile);
      return { loggedOut: true };
    }),
  );

const profile = program.command("profile").description("Manage local profiles");
profile.command("list").action(run(async () => new ProfileStore().read()));
profile.command("use <name>").action(
  run(async (name?: string) => {
    await new ProfileStore().setActive(String(name));
    return { activeProfile: name };
  }),
);
profile.command("remove <name>").action(
  run(async (name?: string) => {
    const authBroker = broker();
    await authBroker.logout(String(name));
    await authBroker.profiles.remove(String(name));
    return { removed: name };
  }),
);

const routes = program
  .command("routes")
  .description("Inspect and safely probe the route catalog");
routes
  .command("tree")
  .action(() =>
    print(
      Object.fromEntries(
        Object.entries(routeCatalog.tree()).map(([module, items]) => [
          module,
          items.map((route) => `${route.method} ${route.id} ${route.path}`),
        ]),
      ),
      jsonOutput(),
    ),
  );
routes
  .command("search <query>")
  .action((query) => print(routeCatalog.search(query), jsonOutput()));
routes
  .command("show <routeId>")
  .action((routeId) => print(routeCatalog.get(routeId), jsonOutput()));
routes
  .command("probe <routeId>")
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
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
routes
  .command("serve")
  .description("open the local route explorer")
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
      process.stdout.write(`Explorer: ${server.url}\nPress Ctrl+C to stop.\n`);
      await open(server.url);
      await new Promise<void>((resolve) => process.once("SIGINT", resolve));
      await server.close();
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

program
  .command("account")
  .command("show")
  .action(withClient((client) => client.users.getOwnInfo()));
const users = program.command("users");
users
  .command("search <query>")
  .option("--limit <number>", "maximum results", "20")
  .action(async (query, options) => {
    try {
      print(
        await (await broker().restore()).users.searchAutocomplete(
          query,
          Number(options.limit),
        ),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
users.command("show <username>").action(async (username) => {
  try {
    print(
      await (await broker().restore()).users.getInfo(username),
      jsonOutput(),
    );
  } catch (error) {
    fail(error, jsonOutput());
  }
});

const notifications = program.command("notifications");
notifications
  .command("list")
  .action(withClient((client) => client.notifications.getAll()));
notifications
  .command("badges")
  .action(withClient((client) => client.notifications.getBadges()));
notifications
  .command("read-all")
  .action(withClient((client) => client.notifications.readAll()));

const calendar = program.command("calendar");
calendar
  .command("upcoming")
  .action(withClient((client) => client.calendar.getUpcomingEvents()));
calendar
  .command("sources")
  .action(withClient((client) => client.calendar.getEventSources()));
calendar
  .command("events")
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
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const files = program.command("files");
files
  .command("quota")
  .action(withClient((client) => client.files.getDiskSpace()));
files.command("size <path>").action(async (path) => {
  try {
    print(
      await (await broker().restore()).files.getFolderSize(path),
      jsonOutput(),
    );
  } catch (error) {
    fail(error, jsonOutput());
  }
});

const mail = program.command("mail");
mail
  .command("list")
  .option("--limit <number>", "maximum messages", "20")
  .action(async (options) => {
    try {
      print(
        await (await broker().restore()).email.getEmails({
          limit: Number(options.limit),
        }),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
mail
  .command("show <uid>")
  .option("--mailbox <name>", "mailbox", "INBOX")
  .action(async (uid, options) => {
    try {
      print(
        await (await broker().restore()).email.getMessage(
          Number(uid),
          options.mailbox,
        ),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
mail
  .command("send")
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
      print({ sent: true }, jsonOutput());
    } catch (error) {
      fail(error, jsonOutput());
    }
  });

const messenger = program.command("messenger");
messenger
  .command("rooms")
  .action(withClient((client) => client.messenger.getRooms()));
messenger
  .command("messages <roomId>")
  .option("--limit <number>", "maximum messages", "20")
  .action(async (roomId, options) => {
    try {
      print(
        await (await broker().restore()).messenger.getMessages(roomId, {
          limit: Number(options.limit),
        }),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("send <roomId>")
  .requiredOption("--body <body>")
  .action(async (roomId, options) => {
    try {
      print(
        await (await broker().restore()).messenger.sendMessage(
          roomId,
          options.body,
        ),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger
  .command("delete <roomId> <eventId>")
  .action(async (roomId, eventId) => {
    try {
      print(
        await (await broker().restore()).messenger.deleteMessage(
          roomId,
          eventId,
        ),
        jsonOutput(),
      );
    } catch (error) {
      fail(error, jsonOutput());
    }
  });
messenger.command("leave <roomId>").action(async (roomId) => {
  try {
    await (await broker().restore()).messenger.leaveRoom(roomId);
    print({ left: true, roomId }, jsonOutput());
  } catch (error) {
    fail(error, jsonOutput());
  }
});
program
  .command("conference")
  .command("health")
  .action(withClient((client) => client.conference.getHealth()));

program.parseAsync().catch((error) => {
  if (!(error instanceof CommanderExit)) fail(error, jsonOutput());
});
