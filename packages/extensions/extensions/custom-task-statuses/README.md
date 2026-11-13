# Custom Task Statuses

**Make your task list speak the language of your workflow.**

Not every task fits neatly into Todo, In Progress, or Done. Add your own states—such as **Needs Design**, **Blocked**, or **Waiting for QA**—with recognizable colors and a place alongside AiderDesk's built-in states.

Your custom states appear in the sidebar's **Change state** menu, state filters, and task status chips, so you can see what needs attention at a glance.

## Shape your workflow

Use custom states to describe the steps and handoffs that matter to you:

- **Plan before coding:** distinguish **Needs Research**, **Needs Design**, and **Awaiting Approval** from tasks that are ready to implement.
- **Make blockers visible:** mark tasks as **Blocked**, **Waiting for Feedback**, or **Waiting on Dependency** instead of leaving them mixed in with active work.
- **Track delivery beyond implementation:** add **Waiting for QA**, **Ready for Release**, or **Deployed** to follow work through validation and delivery.
- **Separate decisions from execution:** use **Needs Triage**, **On Hold**, or **Won't Do** to keep your backlog meaningful.

For example, place **Needs Design** between Todo and Ready for Implementation, or **Waiting for QA** between Ready for Review and Done. Use colors to make handoffs and blockers easy to spot, then filter the sidebar to focus on the states relevant to your next step.

## Turn states into context-aware actions

Custom states can also serve as a shared vocabulary for other extensions—not just labels in your sidebar.

A companion extension can inspect the current task's state and show UI that fits that stage of your workflow. For example:

- **Needs Design:** show a **Draft a plan** action or a design checklist.
- **Blocked:** display the blocking dependency and an action to revisit it.
- **Waiting for QA:** offer a **Run validation** action or show testing instructions.
- **Ready for Release:** present a release checklist or an action to prepare release notes.

These components can appear in AiderDesk's task-state action area (`TaskStateActions`). Extensions can contribute inline actions through the `task-state-actions` placement, or provide a replacement section through `task-state-actions-all`. They can also show state-specific badges or panels in other supported UI placements.

**This extension defines the states; companion extensions provide the behavior.** Adding a state does not automatically create buttons, enforce a workflow, or run an action.

## Make it yours

Open **Settings → Extensions**, then click the gear icon for **Custom Task Statuses**.

1. Click **Add custom state**.
2. Give it a unique ID, a display name, and a color.
3. Use the **up/down arrows** to position it among the existing states.
4. Click **Save** to make it available in the sidebar.

Built-in states are shown as read-only reference points. You can move custom states around them, but cannot edit, recolor, reorder, or remove the built-ins themselves.

Custom states can be edited or removed at any time. Cancel closes the configuration without applying your changes.

## Change a task's state

Choose a state from the task's **Change state** menu in the sidebar, or use:

```text
/task-state WAITING_FOR_QA
```

Run `/task-state` without an ID to list your configured custom states.

Other extensions can assign the same states through the task API:

```typescript
await taskContext.updateTask({ state: "WAITING_FOR_QA" });
```

Use the same ID in your configuration and companion extensions; the display name and color can change independently.

## Good to know

- **Built-in behavior stays intact.** Custom states do not replace AiderDesk's execution lifecycle. Automatic task-state transitions still apply.
- **IDs are stable references.** Use letters, digits, hyphens, and underscores, starting with a letter or digit. IDs must be unique and cannot reuse a built-in ID.
- **Existing tasks are preserved.** Renaming or removing a state ID does not migrate tasks already using it. Those tasks retain their original ID with AiderDesk's fallback display. The same applies if the extension is disabled.
- **Settings follow the installation.** Definitions are saved in this extension's directory and shared across projects where that installation is enabled.
- **Colors are flexible.** Pick a color visually, or enter a hex value in the text field, including an alpha channel if needed.
- **Requires core task-state support.** Use an AiderDesk build with the `getTaskStates` extension API. After upgrading from an older build, restart the application.
