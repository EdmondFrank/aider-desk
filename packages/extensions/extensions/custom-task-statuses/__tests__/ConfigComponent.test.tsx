// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, Fragment, useState } from "react";
import { transform } from "sucrase";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
} from "react";
import type { TaskStateDefinition } from "@aiderdesk/extensions";

import { BUILT_IN_STATES } from "../config";

const source = readFileSync(join(__dirname, "../ConfigComponent.jsx"), "utf-8");
const compiled = transform(`return (${source.trim().replace(/;$/, "")});`, {
  transforms: ["jsx"],
  production: true,
}).code;
const Component = new Function("React", compiled)({
  createElement,
  Fragment,
}) as ComponentType<Record<string, unknown>>;
const resources = JSON.parse(
  readFileSync(join(__dirname, "../locales.json"), "utf-8"),
);
const labels = resources.en.translation.customTaskStatuses;
const state = {
  id: "BLOCKED",
  name: "Blocked",
  color: "#f97316",
  priority: 25,
};
const ui = {
  Input: ({
    label,
    size,
    wrapperClassName,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
    label?: string;
    size?: string;
    wrapperClassName?: string;
  }) => {
    void size;
    void wrapperClassName;
    return createElement("label", {}, label, createElement("input", props));
  },
  Button: ({
    size,
    variant,
    color,
    ...props
  }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
    size?: string;
    variant?: string;
    color?: string;
  }) => {
    void size;
    void variant;
    void color;
    return createElement("button", props);
  },
};
const Icon = () => null;
const icons = {
  Fi: { FiArrowUp: Icon, FiArrowDown: Icon, FiTrash2: Icon, FiPlus: Icon },
};

const mount = (initialStates: TaskStateDefinition[] = []) => {
  let current = initialStates;
  const Wrapper = () => {
    const [config, setConfig] = useState({
      states: initialStates,
      builtInStates: BUILT_IN_STATES,
      labels,
    });
    current = config.states;
    return createElement(Component, {
      config,
      updateConfig: setConfig,
      ui,
      icons,
    });
  };
  render(createElement(Wrapper));
  return () => current;
};

const up = (id: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Move up ${id}` }));
const down = (id: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Move down ${id}` }));

afterEach(cleanup);

describe("custom state configuration UI", () => {
  it("renders built-ins without editing, removal, or ordering controls", () => {
    mount();
    BUILT_IN_STATES.forEach((builtIn) => {
      expect(screen.getByText(builtIn.name)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: `Move up ${builtIn.id}` }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: `Remove ${builtIn.id}` }),
      ).toBeNull();
    });
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("adds, edits, recolors, and removes custom states", () => {
    const current = mount();
    fireEvent.click(screen.getByRole("button", { name: "Add custom state" }));
    expect(current()[0]).toMatchObject({ id: "CUSTOM_STATE", priority: 90 });
    fireEvent.change(screen.getByRole("textbox", { name: "ID 1" }), {
      target: { value: "WAITING" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name 1" }), {
      target: { value: "Waiting" },
    });
    fireEvent.change(screen.getByLabelText("Color 1"), {
      target: { value: "#aabbcc" },
    });
    expect(current()[0]).toMatchObject({
      id: "WAITING",
      name: "Waiting",
      color: "#aabbcc",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Hex color 1" }), {
      target: { value: "#aabbcc88" },
    });
    expect(current()[0].color).toBe("#aabbcc88");
    fireEvent.click(screen.getByRole("button", { name: "Remove WAITING" }));
    expect(current()).toEqual([]);
  });

  it("moves a custom state across fixed built-in states in both directions", () => {
    const current = mount([state]);
    up("BLOCKED");
    expect(current()[0].priority).toBe(15);
    down("BLOCKED");
    expect(current()[0].priority).toBe(25);
    expect(BUILT_IN_STATES.map((builtIn) => builtIn.priority)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80,
    ]);
  });

  it("handles the start and end boundaries", () => {
    const current = mount([{ ...state, priority: 15 }]);
    up("BLOCKED");
    expect(current()[0].priority).toBe(0);
    expect(
      (
        screen.getByRole("button", {
          name: "Move up BLOCKED",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    for (let i = 0; i < 8; i++) {
      down("BLOCKED");
    }
    expect(current()[0].priority).toBe(90);
    expect(
      (
        screen.getByRole("button", {
          name: "Move down BLOCKED",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("reorders custom states within the same built-in gap without tied priorities", () => {
    const current = mount([
      state,
      { ...state, id: "WAITING", name: "Waiting", priority: 26 },
    ]);
    up("WAITING");
    const states = current();
    expect(states.map((s) => s.id)).toEqual(["WAITING", "BLOCKED"]);
    expect(states[0].priority).toBeGreaterThan(20);
    expect(states[0].priority).toBeLessThan(states[1].priority);
    expect(states[1].priority).toBeLessThan(30);
  });

  it("generates unique IDs and warns about invalid definitions", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add custom state" }));
    fireEvent.click(screen.getByRole("button", { name: "Add custom state" }));
    expect(
      (screen.getByRole("textbox", { name: "ID 2" }) as HTMLInputElement).value,
    ).toBe("CUSTOM_STATE_2");
    fireEvent.change(screen.getByRole("textbox", { name: "ID 2" }), {
      target: { value: "TODO" },
    });
    expect(screen.getByRole("alert").textContent).toBe(labels.validation);
  });
});
