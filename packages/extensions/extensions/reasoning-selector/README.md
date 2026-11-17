# Reasoning Selector

Adds a reasoning-effort selector next to the model selector in Agent Mode.

![Reasoning Selector](https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/reasoning-selector/screenshot.png)

## Usage

1. Enable the extension and open a task in Agent Mode.
2. Choose a reasoning effort from the selector: **Use default**, **None**, **Minimal**, **Low**, **Medium**, **High**, or **xHigh**.
3. Start the task. The selected reasoning effort is applied to models that support reasoning.

Choose **Use default** to leave the model's default reasoning behavior unchanged.

## Saved preferences

Explicit reasoning choices are saved per provider profile and model in `<project>/.aider-desk/reasoning-selector.json`. Preferences are project-specific and survive restarts and task deletion; they no longer depend on recent task history.

- Selecting a model or switching agent profiles restores that model's saved reasoning choice. Models without a saved choice use their provider default.
- New tasks start with the effective model's saved choice, unless reasoning was explicitly supplied when creating the task.
- **Use default** is saved explicitly and clears the task's reasoning override. **None** remains an explicit override disabling reasoning where supported.
- Existing tasks keep their current reasoning until their model or reasoning selection changes. Changing a preference in one task does not modify other existing tasks.
- Task-level provider/model overrides take precedence over the task's agent profile, which otherwise falls back to the project's default agent profile.

The extension records the model associated with each task's reasoning in task metadata, so switching models cannot accidentally save the previous model's reasoning under the new model. Preference writes are serialized within the extension process and use an atomic file replacement. If the preferences file is invalid, the extension logs a warning and uses the provider default when restoring; it refuses to overwrite the invalid file.
