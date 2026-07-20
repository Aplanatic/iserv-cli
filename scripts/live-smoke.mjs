import { spawnSync } from "node:child_process";

function run(args) {
  return spawnSync(process.execPath, ["dist/main.mjs", ...args], {
    encoding: "utf8",
  });
}

function parse(result) {
  if (result.status !== 0) return {};
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {};
  }
}

const authResult = run(["--json", "auth", "status"]);
const auth = parse(authResult);
const human = run(["auth", "status"]);
const accountResult = run(["--json", "account", "info"]);
const account = parse(accountResult);
const etherpadResult = run(["--json", "etherpads", "list"]);
const etherpad = parse(etherpadResult);
const roomsResult = run(["--json", "messenger", "rooms"]);

const checks = {
  authenticated: authResult.status === 0 && auth.authenticated === true,
  accountNamed:
    Boolean(auth.account?.displayName && auth.account?.username) &&
    human.stdout.includes(auth.account.displayName) &&
    human.stdout.includes(auth.account.username),
  capabilitiesVerified:
    auth.capabilitiesVerified === true && auth.capabilities?.length > 0,
  accountRead:
    accountResult.status === 0 && account.routeId === "account.info" && account.status === 200,
  etherpadRead:
    etherpadResult.status === 0 &&
    etherpad.routeId === "etherpad.list" &&
    etherpad.status === 200,
  messengerRead: roomsResult.status === 0,
};

console.log(JSON.stringify(checks));
if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
