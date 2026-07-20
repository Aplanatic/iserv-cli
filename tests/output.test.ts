import type { RouteDefinition } from "@aplanatic/iserv-api";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CommanderExit,
  fail,
  formatHuman,
  print,
  printAuthStatus,
  printProfiles,
  printReadRoute,
  printRoute,
  printRoutes,
  printRouteTree,
  printSuccess,
  uiStyle,
} from "../src/output.js";

const route: RouteDefinition = {
  id: "calendar.upcoming",
  module: "calendar",
  method: "GET",
  path: "/iserv/calendar/api/upcoming",
  summary: "List upcoming calendar events",
  description: "Returns upcoming events from subscribed calendars.",
  authentication: "session",
  sideEffect: "read",
  status: "supported",
  parameters: [
    {
      name: "limit",
      location: "query",
      required: false,
      description: "Maximum events",
    },
  ],
  provenance: {
    kind: "upstream-sdk",
    reference: "src/Calendar/CalendarService.ts",
  },
};

function captureStdout(action: () => void): string {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    action();
  } finally {
    spy.mockRestore();
  }
  return output;
}

function captureStderr(action: () => void): string {
  let output = "";
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    action();
  } finally {
    spy.mockRestore();
  }
  return output;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("human output", () => {
  test("formats nested records as compact sections and tables", () => {
    expect(
      formatHuman(
        {
          count: 2,
          connected: true,
          items: [
            { title: "First", status: "new" },
            { title: "Second", status: "done" },
          ],
          paging: { next: null, limit: 20 },
        },
        { title: "Notifications", color: false, width: 80 },
      ),
    ).toMatchInlineSnapshot(`
      "Notifications
      Count      2
      Connected  Yes

      Items  2
        Title    Status
        First    new
        Second   done

      Paging
        Next   —
        Limit  20
      "
    `);
  });

  test("renders intentional route discovery views", () => {
    expect(
      captureStdout(() => {
        printRoutes([route], "calendar", false, { color: false, width: 96 });
        printRouteTree({ calendar: [route] }, false, { color: false });
        printRoute(route, false, { color: false, width: 96 });
      }),
    ).toMatchInlineSnapshot(`
      "Routes matching "calendar"  1
        Method   Id                  Module     Status      Summary
        GET      calendar.upcoming   calendar   supported   List upcoming calendar events
      Routes  1 routes \u00b7 1 modules

      Calendar
        GET      calendar.upcoming  /iserv/calendar/api/upcoming
      GET     calendar.upcoming
      List upcoming calendar events

      Path            /iserv/calendar/api/upcoming
      Module          calendar
      Authentication  session
      Side effect     read
      Status          supported

      Returns upcoming events from subscribed calendars.

      Parameters
        Name    In      Required   Description
        limit   query   no         Maximum events

      Provenance  Upstream sdk \u00b7 src/Calendar/CalendarService.ts
      "
    `);
  });

  test("renders auth, profile, and success states", () => {
    expect(
      captureStdout(() => {
        printAuthStatus(
          {
            profile: "school",
            configured: true,
            authenticated: true,
            account: { username: "student", displayName: "Example Student" },
            capabilitiesVerified: true,
            capabilities: [
              {
                module: "calendar",
                access: "available",
                catalogued: {
                  read: 4,
                  write: 0,
                  communicative: 1,
                  destructive: 1,
                },
                verifiedReadRoutes: 3,
              },
              {
                module: "pinboard",
                access: "experimental",
                catalogued: {
                  read: 0,
                  write: 0,
                  communicative: 0,
                  destructive: 0,
                },
                verifiedReadRoutes: 0,
              },
            ],
          },
          false,
          { color: false },
        );
        printProfiles(
          {
            activeProfile: "school",
            profiles: [
              {
                name: "school",
                username: "student",
                hostname: "iserv.example",
              },
              {
                name: "archive",
                username: "student",
                hostname: "iserv.example",
              },
            ],
          },
          false,
          { color: false },
        );
        printSuccess("Connected", { profile: "school" }, false, {
          color: false,
        });
      }),
    ).toMatchInlineSnapshot(`
      "Session
      ● Connected
      Profile  school
      Name     Example Student
      Username student

      Capabilities  1 available · live checked
        Module     Access         Verified Reads   Catalogued
        calendar   available      3                4 read · 1 send/create · 1 destructive
        pinboard   experimental   0                0 read

      1 module(s) are experimental, unavailable, or not installed. Write permissions are checked only when an action runs.
      Profiles  2
      ● school   student · iserv.example
      ○ archive  student · iserv.example
      ✓ Connected
        Profile  school
      "
    `);
  });

  test("renders a read-only module result with html-extracted data", () => {
    expect(
      captureStdout(() =>
        printReadRoute(
          "Past exercises",
          {
            routeId: "exercise.past",
            status: 200,
            durationMs: 82,
            data: {
              kind: "html-extracted",
              title: "Past Exercises - IServ",
              tables: [
                {
                  caption: "Exercise List",
                  headers: ["Subject", "Due Date"],
                  rows: [
                    { Subject: "Math", "Due Date": "2026-07-25" },
                    { Subject: "English", "Due Date": "2026-07-28" },
                  ],
                },
              ],
              keyValues: { Teacher: "Mr. Smith", Class: "12A" },
              lists: [
                { label: "Attachments", items: ["worksheet.pdf", "notes.pdf"] },
              ],
              sections: [
                {
                  level: 2,
                  heading: "Instructions",
                  content: ["Complete all exercises by the due date."],
                },
              ],
              links: [{ text: "Submit", href: "/iserv/exercise/submit/1" }],
              forms: [],
              metadata: { _user: "student", _csrf_present: "yes" },
              bytes: 12345,
            },
          },
          false,
          { color: false },
        ),
      ),
    ).toMatchInlineSnapshot(`
      "Past exercises
      ● OK  200 · 82 ms

      Kind   html-extracted
      Title  Past Exercises - IServ
      Bytes  12345

      Tables  1
        Caption         Headers   Rows
        Exercise List   2 items   2 items

      Lists  1
        Label         Items
        Attachments   2 items

      Sections  1
        Level   Heading        Content
        2       Instructions   1 items

      Links  1
        Text     Href
        Submit   /iserv/exercise/submit/1

      Forms  0
        None

      Key Values
        Teacher  Mr. Smith
        Class    12A

      Metadata
        User          student
        Csrf present  yes
      "
    `);
  });

  test("renders legacy html-structure data as key-value table", () => {
    expect(
      captureStdout(() =>
        printReadRoute(
          "Legacy",
          {
            routeId: "test.route",
            status: 200,
            durationMs: 10,
            data: {
              kind: "html-structure",
              bytes: 5000,
              links: 5,
              headings: 2,
              tables: 1,
              tableRows: 3,
              forms: { GET: 1 },
            },
          },
          false,
          { color: false },
        ),
      ),
    ).toMatchInlineSnapshot(`
      "Legacy
      ● OK  200 · 10 ms

      Kind        html-structure
      Bytes       5000
      Links       5
      Headings    2
      Tables      1
      Table Rows  3

      Forms
        GET  1
      "
    `);
  });
});

describe("automation and errors", () => {
  test("keeps JSON compact, stable, and redacted", () => {
    const output = captureStdout(() =>
      print(
        {
          authenticated: true,
          password: "do-not-print",
          instance: "school.example.org",
        },
        true,
      ),
    );
    expect(output).toBe(
      '{"authenticated":true,"password":"[redacted]","instance":"[redacted-host]"}\n',
    );

    const tree = captureStdout(() =>
      printRouteTree({ calendar: [route] }, true),
    );
    expect(tree).toBe(
      '{"calendar":["GET calendar.upcoming /iserv/calendar/api/upcoming"]}\n',
    );
  });

  test("adds a useful human hint while preserving the JSON error schema", () => {
    const human = captureStderr(() => {
      expect(() => fail(new Error("No active session"), false)).toThrow(
        CommanderExit,
      );
    });
    expect(human).toContain("No active session");
    expect(human).toContain("iserv auth login");
    expect(process.exitCode).toBe(3);

    process.exitCode = undefined;
    const json = captureStderr(() => {
      expect(() => fail(new Error("No active session"), true)).toThrow(
        CommanderExit,
      );
    });
    expect(json).toBe('{"error":"No active session","code":3}\n');
  });

  test("uses color only when explicitly enabled in deterministic rendering", () => {
    expect(uiStyle(false).green("ready")).toBe("ready");
    expect(uiStyle(true).green("ready")).toContain("\u001B[32m");
  });
});
