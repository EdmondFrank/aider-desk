import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BUILT_IN_TASK_STATE_DEFINITIONS } from "../../../../common/src/task-states";
import {
  BUILT_IN_STATES,
  loadConfig,
  saveConfig,
  validateConfig,
} from "../config";

const state = {
  id: "BLOCKED",
  name: "Blocked",
  color: "#f97316",
  priority: 25,
};
const tempDirs: string[] = [];

const configPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "custom-task-statuses-"));
  tempDirs.push(dir);
  return join(dir, "config.json");
};

afterEach(() => {
  tempDirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("custom task status configuration", () => {
  it("keeps the read-only built-in references in sync with core", () => {
    expect(BUILT_IN_STATES).toEqual(BUILT_IN_TASK_STATE_DEFINITIONS);
  });

  it("starts with no custom states without writing a config file", () => {
    expect(loadConfig(configPath())).toEqual({ states: [] });
  });

  it("round trips custom definitions and persists no UI-only fields", () => {
    const path = configPath();
    expect(
      saveConfig(path, {
        states: [{ ...state, name: " Blocked " }],
        labels: {},
        builtInStates: BUILT_IN_STATES,
      }),
    ).toEqual({ states: [state] });
    expect(loadConfig(path)).toEqual({ states: [state] });
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
      states: [state],
    });
    saveConfig(path, { states: [] });
    expect(loadConfig(path)).toEqual({ states: [] });
  });

  it.each(["#abc", "#abcd", "#123456", "#12345678"])(
    "accepts core-supported hex color %s",
    (color) => {
      expect(
        validateConfig({ states: [{ ...state, color }] }).states[0].color,
      ).toBe(color);
    },
  );

  it.each([
    { id: "" },
    { id: "bad id" },
    { id: "-start" },
    { id: "TODO" },
    { name: "" },
    { name: "   " },
    { color: "red" },
    { color: "var(--color-info)" },
    { color: "#12345" },
    { priority: Infinity },
    { priority: NaN },
    { priority: "25" },
  ])("rejects invalid state fields %j", (changes) => {
    expect(() =>
      validateConfig({ states: [{ ...state, ...changes }] }),
    ).toThrow();
  });

  it("rejects duplicate IDs and malformed configuration", () => {
    expect(() => validateConfig({ states: [state, state] })).toThrow(
      "already in use",
    );
    [null, [], {}, { states: null }, { states: [null] }].forEach((value) => {
      expect(() => validateConfig(value)).toThrow();
    });
  });

  it("preserves the previous file when saving invalid input", () => {
    const path = configPath();
    saveConfig(path, { states: [state] });
    expect(() => saveConfig(path, { states: [state, state] })).toThrow();
    expect(loadConfig(path)).toEqual({ states: [state] });
  });

  it("reports invalid persisted configuration instead of overwriting it", () => {
    const path = configPath();
    writeFileSync(path, "{invalid json");
    expect(() => loadConfig(path)).toThrow();
    expect(readFileSync(path, "utf-8")).toBe("{invalid json");
  });
});
