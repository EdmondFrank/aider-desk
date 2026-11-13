import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "@aiderdesk/extensions";

import CustomTaskStatusesExtension from "../index";
import * as config from "../config";

const state = {
  id: "BLOCKED",
  name: "Blocked",
  color: "#f97316",
  priority: 25,
};
const updateTask = vi.fn();
const addLogMessage = vi.fn();
const context = {
  getSetting: vi.fn().mockResolvedValue("en"),
  getTaskContext: () => ({ updateTask, addLogMessage }),
} as unknown as ExtensionContext;

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Custom Task Statuses extension", () => {
  it("contributes only custom states", () => {
    vi.spyOn(config, "loadConfig").mockReturnValue({ states: [state] });
    expect(new CustomTaskStatusesExtension().getTaskStates()).toEqual([state]);
  });

  it("provides built-in references and localized configuration labels", async () => {
    vi.spyOn(config, "loadConfig").mockReturnValue({ states: [state] });
    const data = await new CustomTaskStatusesExtension().getConfigData(context);
    expect(data).toMatchObject({
      states: [state],
      builtInStates: config.BUILT_IN_STATES,
      labels: { add: "Add custom state" },
    });
  });

  it("falls back to English for an unsupported language", async () => {
    vi.spyOn(config, "loadConfig").mockReturnValue({ states: [] });
    vi.mocked(context.getSetting).mockResolvedValueOnce("unsupported");
    expect(
      await new CustomTaskStatusesExtension().getConfigData(context),
    ).toMatchObject({ labels: { add: "Add custom state" } });
  });

  it("saves through the validated persistence helper", async () => {
    const save = vi
      .spyOn(config, "saveConfig")
      .mockReturnValue({ states: [state] });
    expect(
      await new CustomTaskStatusesExtension().saveConfigData({
        states: [state],
      }),
    ).toEqual({ states: [state] });
    expect(save).toHaveBeenCalledWith(expect.stringContaining("config.json"), {
      states: [state],
    });
  });

  it("sets configured states by ID and lists states without arguments", async () => {
    vi.spyOn(config, "loadConfig").mockReturnValue({ states: [state] });
    const command = new CustomTaskStatusesExtension().getCommands()[0];
    await command.execute(["BLOCKED"], context);
    expect(updateTask).toHaveBeenCalledWith({ state: "BLOCKED" });
    await command.execute([], context);
    expect(addLogMessage).toHaveBeenCalledWith("info", "BLOCKED: Blocked");
  });

  it("does not change tasks for an unknown state", async () => {
    vi.spyOn(config, "loadConfig").mockReturnValue({ states: [] });
    await new CustomTaskStatusesExtension()
      .getCommands()[0]
      .execute(["MISSING"], context);
    expect(updateTask).not.toHaveBeenCalled();
    expect(addLogMessage).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("MISSING"),
    );
  });
});
