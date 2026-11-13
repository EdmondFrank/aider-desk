import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { TaskStateDefinition } from "@aiderdesk/extensions";

export const BUILT_IN_STATES: TaskStateDefinition[] = [
  {
    id: "TODO",
    name: "Todo",
    color: "var(--color-text-primary)",
    priority: 10,
  },
  {
    id: "READY_FOR_IMPLEMENTATION",
    name: "Ready for Implementation",
    color: "var(--color-info-light)",
    priority: 20,
  },
  {
    id: "IN_PROGRESS",
    name: "In Progress",
    color: "var(--color-button-primary)",
    priority: 30,
  },
  {
    id: "INTERRUPTED",
    name: "Interrupted",
    color: "var(--color-button-danger)",
    priority: 40,
  },
  {
    id: "DELEGATED",
    name: "Delegated",
    color: "var(--color-warning)",
    priority: 50,
  },
  {
    id: "MORE_INFO_NEEDED",
    name: "More Info Needed",
    color: "var(--color-error)",
    priority: 60,
  },
  {
    id: "READY_FOR_REVIEW",
    name: "Ready for Review",
    color: "var(--color-success-light)",
    priority: 70,
  },
  {
    id: "DONE",
    name: "Done",
    color: "var(--color-text-muted-light)",
    priority: 80,
  },
];

export interface StatusConfig {
  states: TaskStateDefinition[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const validateConfig = (value: unknown): StatusConfig => {
  if (!isRecord(value) || !Array.isArray(value.states)) {
    throw new Error("Expected a list of custom task states.");
  }

  const ids = new Set(BUILT_IN_STATES.map((state) => state.id));
  const states = value.states.map((state: unknown): TaskStateDefinition => {
    if (
      !isRecord(state) ||
      typeof state.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(state.id) ||
      typeof state.name !== "string" ||
      !state.name.trim() ||
      typeof state.color !== "string" ||
      !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(
        state.color,
      ) ||
      typeof state.priority !== "number" ||
      !Number.isFinite(state.priority)
    ) {
      throw new Error(
        "Each custom state needs a valid ID, name, hex color, and finite priority.",
      );
    }
    if (ids.has(state.id)) {
      throw new Error(`Task state ID "${state.id}" is already in use.`);
    }
    ids.add(state.id);
    return {
      id: state.id,
      name: state.name.trim(),
      color: state.color,
      priority: state.priority,
    };
  });
  return { states };
};

export const loadConfig = (path: string): StatusConfig => {
  if (!existsSync(path)) {
    return { states: [] };
  }
  return validateConfig(JSON.parse(readFileSync(path, "utf-8")));
};

export const saveConfig = (path: string, value: unknown): StatusConfig => {
  const config = validateConfig(value);
  writeFileSync(path, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return config;
};
