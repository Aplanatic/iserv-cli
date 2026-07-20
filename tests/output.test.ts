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
      "Routes matching “calendar”  1
        Method   Id                  Module     Status      Summary
        GET      calendar.upcoming   calendar   supported   List upcoming calendar events
      Routes  1 routes · 1 modules

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

      Provenance  Upstream sdk · src/Calendar/CalendarService.ts
      "
    `);
  });

  test("renders auth, profile, and success states", () => {
    expect(
      captureStdout(() => {
        printAuthStatus(
          { profile: "school", configured: true, authenticated: true },
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
      Profiles  2
      ● school   student · iserv.example
      ○ archive  student · iserv.example
      ✓ Connected
        Profile  school
      "
    `);
  });

  test("renders a calm read-only module result without page content", () => {
    expect(
      captureStdout(() =>
        printReadRoute(
          "Past exercises",
          {
            routeId: "exercise.past",
            status: 200,
            durationMs: 82,
            data: {
              kind: "html-structure",
              bytes: 12345,
              links: 12,
              headings: 1,
              tables: 1,
              tableRows: 4,
              forms: { GET: 2, POST: 1 },
            },
          },
          false,
          { color: false },
        ),
      ),
    ).toMatchInlineSnapshot(`
      "Past exercises
      ● Available  200 · 82 ms
      Route  exercise.past

      Page structure
        Rows           4
        Tables         1
        Headings       1
        Links          12
        Response size  12345 bytes

      Read-only check · page content and form values were not returned.
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
    expect(json).toBe('{"error":"No active session"}\n');
  });

  test("uses color only when explicitly enabled in deterministic rendering", () => {
    expect(uiStyle(false).green("ready")).toBe("ready");
    expect(uiStyle(true).green("ready")).toContain("\u001B[32m");
  });
});
