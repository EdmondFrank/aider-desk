({ config, updateConfig, ui, icons }) => {
  const { Input, Button } = ui;
  const { FiArrowUp, FiArrowDown, FiTrash2, FiPlus } = icons.Fi;
  const states = config?.states || [];
  const builtInStates = config?.builtInStates || [];
  const labels = config?.labels || {};
  const rows = [
    ...builtInStates.map((state) => ({ ...state, builtIn: true })),
    ...states.map((state, customIndex) => ({
      ...state,
      builtIn: false,
      customIndex,
    })),
  ].sort(
    (a, b) =>
      a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const ids = [...builtInStates, ...states].map((state) => state.id);
  const hasErrors = states.some(
    (state) =>
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(state.id) ||
      ids.filter((id) => id === state.id).length > 1 ||
      !state.name.trim() ||
      !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(state.color),
  );

  const pickerColor = (color) => {
    if (/^#[\da-f]{3,4}$/i.test(color)) {
      return (
        "#" +
        color
          .slice(1, 4)
          .split("")
          .map((digit) => digit + digit)
          .join("")
      );
    }
    return /^#[\da-f]{6}([\da-f]{2})?$/i.test(color)
      ? color.slice(0, 7)
      : "#8b5cf6";
  };

  const updateState = (index, changes) => {
    updateConfig({
      ...config,
      states: states.map((state, i) =>
        i === index ? { ...state, ...changes } : state,
      ),
    });
  };

  const moveState = (index, direction) => {
    const reordered = [...rows];
    const target = index + direction;
    if (target < 0 || target >= reordered.length || reordered[index].builtIn) {
      return;
    }
    const moved = reordered.splice(index, 1)[0];
    reordered.splice(target, 0, moved);
    const customStates = [];
    let lowerPriority = null;
    let pending = [];
    const assignPriorities = (upperPriority) => {
      pending.forEach((state, offset) => {
        const priority =
          lowerPriority === null
            ? upperPriority - (pending.length - offset) * 10
            : upperPriority === null
              ? lowerPriority + (offset + 1) * 10
              : lowerPriority +
                ((upperPriority - lowerPriority) * (offset + 1)) /
                  (pending.length + 1);
        customStates.push({
          id: state.id,
          name: state.name,
          color: state.color,
          priority,
        });
      });
      pending = [];
    };
    reordered.forEach((state) => {
      if (state.builtIn) {
        assignPriorities(state.priority);
        lowerPriority = state.priority;
      } else {
        pending.push(state);
      }
    });
    assignPriorities(null);
    updateConfig({ ...config, states: customStates });
  };

  const handleAdd = () => {
    let suffix = 1;
    let id = "CUSTOM_STATE";
    while (ids.includes(id)) {
      id = `CUSTOM_STATE_${++suffix}`;
    }
    updateConfig({
      ...config,
      states: [
        ...states,
        {
          id,
          name: labels.newState,
          color: "#8b5cf6",
          priority: Math.max(0, ...rows.map((state) => state.priority)) + 10,
        },
      ],
    });
  };

  const removeState = (index) => {
    updateConfig({
      ...config,
      states: states.filter((state, i) => i !== index),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-secondary">{labels.description}</p>
      <p className="text-xs text-text-muted">{labels.idHint}</p>
      {hasErrors && (
        <p role="alert" className="text-xs text-error">
          {labels.validation}
        </p>
      )}
      {rows.map((state, index) => (
        <div
          key={state.builtIn ? state.id : `custom-${state.customIndex}`}
          className="rounded border border-border-default p-3 flex flex-col gap-2"
        >
          {state.builtIn ? (
            <div className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: state.color }}
              />
              <span className="text-text-primary flex-1">{state.name}</span>
              <span className="text-text-muted">{labels.builtIn}</span>
              <span className="text-text-muted">{state.priority}</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  size="sm"
                  label={labels.id}
                  aria-label={`${labels.id} ${state.customIndex + 1}`}
                  value={state.id}
                  onChange={(e) =>
                    updateState(state.customIndex, { id: e.target.value })
                  }
                />
                <Input
                  size="sm"
                  label={labels.name}
                  aria-label={`${labels.name} ${state.customIndex + 1}`}
                  value={state.name}
                  onChange={(e) =>
                    updateState(state.customIndex, { name: e.target.value })
                  }
                />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  size="sm"
                  type="color"
                  label={labels.color}
                  aria-label={`${labels.color} ${state.customIndex + 1}`}
                  value={pickerColor(state.color)}
                  onChange={(e) =>
                    updateState(state.customIndex, { color: e.target.value })
                  }
                  className="h-8 w-12 p-0.5"
                />
                <Input
                  size="sm"
                  aria-label={`${labels.hexColor} ${state.customIndex + 1}`}
                  value={state.color}
                  onChange={(e) =>
                    updateState(state.customIndex, { color: e.target.value })
                  }
                  wrapperClassName="flex-1 min-w-0"
                />
                <Button
                  size="xs"
                  variant="text"
                  color="tertiary"
                  aria-label={`${labels.moveUp} ${state.id}`}
                  title={labels.moveUp}
                  disabled={index === 0}
                  onClick={() => moveState(index, -1)}
                >
                  <FiArrowUp />
                </Button>
                <Button
                  size="xs"
                  variant="text"
                  color="tertiary"
                  aria-label={`${labels.moveDown} ${state.id}`}
                  title={labels.moveDown}
                  disabled={index === rows.length - 1}
                  onClick={() => moveState(index, 1)}
                >
                  <FiArrowDown />
                </Button>
                <Button
                  size="xs"
                  variant="text"
                  color="danger"
                  aria-label={`${labels.remove} ${state.id}`}
                  title={labels.remove}
                  onClick={() => removeState(state.customIndex)}
                >
                  <FiTrash2 />
                </Button>
              </div>
            </>
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={handleAdd}>
        <FiPlus />
        <span>{labels.add}</span>
      </Button>
      <p className="text-xs text-text-muted">{labels.removalHint}</p>
    </div>
  );
};
