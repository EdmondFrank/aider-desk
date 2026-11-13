import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createInstance } from "i18next";

import type {
  CommandDefinition,
  Extension,
  ExtensionContext,
  TaskStateDefinition,
} from "@aiderdesk/extensions";

import { BUILT_IN_STATES, loadConfig, saveConfig } from "./config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "config.json");

export default class CustomTaskStatusesExtension implements Extension {
  static metadata = {
    name: "Custom Task Statuses",
    version: "1.0.0",
    description:
      "Configure custom task states, colors, and their order alongside read-only built-in states",
    author: "AiderDesk",
    iconUrl:
      "https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/custom-task-statuses/icon.png",
    capabilities: ["task-states", "commands", "ui"],
  };

  getTaskStates(): TaskStateDefinition[] {
    return loadConfig(CONFIG_PATH).states;
  }

  getConfigComponent(): string {
    return readFileSync(join(__dirname, "ConfigComponent.jsx"), "utf-8");
  }

  async getConfigData(context: ExtensionContext): Promise<unknown> {
    const i18n = createInstance();
    const resources = JSON.parse(
      readFileSync(join(__dirname, "locales.json"), "utf-8"),
    );
    const language = await context.getSetting("language");
    await i18n.init({
      lng: typeof language === "string" ? language : "en",
      fallbackLng: "en",
      resources,
    });
    return {
      ...loadConfig(CONFIG_PATH),
      builtInStates: BUILT_IN_STATES.map((state) => ({
        ...state,
        name: i18n.t(`taskState.${state.id}`),
      })),
      labels: i18n.t("customTaskStatuses", { returnObjects: true }),
    };
  }

  async saveConfigData(configData: unknown): Promise<unknown> {
    return saveConfig(CONFIG_PATH, configData);
  }

  getCommands(): CommandDefinition[] {
    return [
      {
        name: "task-state",
        description:
          "Set a custom task state by ID. Without an ID, list configured custom states.",
        arguments: [{ description: "Custom task state ID", required: false }],
        execute: async (
          args: string[],
          context: ExtensionContext,
        ): Promise<void> => {
          const task = context.getTaskContext();
          if (!task) {
            return;
          }
          const states = this.getTaskStates();
          const id = args.join(" ").trim();
          if (!id) {
            task.addLogMessage(
              "info",
              states.map((state) => `${state.id}: ${state.name}`).join("\n") ||
                "No custom task states configured.",
            );
            return;
          }
          const state = states.find((state) => state.id === id);
          if (!state) {
            task.addLogMessage("error", `Unknown custom task state: ${id}`);
            return;
          }
          await task.updateTask({ state: state.id });
        },
      },
    ];
  }
}
