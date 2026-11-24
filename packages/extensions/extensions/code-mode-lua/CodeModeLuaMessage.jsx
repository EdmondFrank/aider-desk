({ message, projectDir, task, ui, icons }) => {
  const { CodeBlock, ExpandableMessageBlock, Tooltip, Chip } = ui;
  const { CgSpinner } = icons.Cg;
  const { RiArrowGoBackLine, RiCheckboxCircleFill, RiCodeSSlashLine, RiErrorWarningFill, RiTerminalBoxLine } = icons.Ri;

  const NO_RETURN = 'Execution completed with no return value.';

  const parseResult = (rawContent) => {
    if (!rawContent) {
      return { text: '', isError: false };
    }

    try {
      const parsed = JSON.parse(rawContent);
      if (typeof parsed === 'string') {
        return { text: parsed, isError: false };
      }

      let value = parsed;
      let isError = false;

      if (value && typeof value === 'object' && (value.type === 'json' || value.type === 'error-json')) {
        isError = value.type === 'error-json';
        value = value.value;
      }

      if (value && typeof value === 'object' && Array.isArray(value.content)) {
        isError = isError || value.isError === true;
        const text = value.content
          .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text)
          .join('');

        if (text) {
          return { text, isError };
        }
      }

      return { text: JSON.stringify(value, null, 2), isError };
    } catch {
      return { text: rawContent, isError: false };
    }
  };

  // code_mode emits the script's stdout first (prefixed with "print output:")
  // and appends the returned value separated by a blank line, e.g.
  //   print output:
  //   <stdout lines>
  //
  //   <return value>
  const splitCodeModeOutput = (text) => {
    const marker = 'print output:';
    let stdout = '';
    let returnValue = text;

    if (text.startsWith(marker)) {
      const rest = text.slice(marker.length).replace(/^\n/, '');
      const separatorIndex = rest.lastIndexOf('\n\n');
      if (separatorIndex === -1) {
        stdout = rest;
        returnValue = '';
      } else {
        stdout = rest.slice(0, separatorIndex);
        returnValue = rest.slice(separatorIndex + 2);
      }
    }

    const trimmedReturn = returnValue.trim();
    const hasReturn = trimmedReturn.length > 0 && trimmedReturn !== NO_RETURN;

    return {
      stdout: stdout.replace(/\n$/, ''),
      returnValue: hasReturn ? trimmedReturn : '',
      hasStdout: stdout.trim().length > 0,
    };
  };

  const formatJson = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }
    const first = trimmed.charAt(0);
    if (first !== '{' && first !== '[') {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Not JSON - fall through to plain rendering.
    }
    return null;
  };

  const result = parseResult(message.content);
  const code = typeof message.args?.code === 'string' ? message.args.code : '';
  const timeout = typeof message.args?.timeout === 'number' ? message.args.timeout : undefined;
  const isRunning = !message.content;
  const { stdout, returnValue, hasStdout } = splitCodeModeOutput(result.text);
  const returnJson = returnValue && !result.isError ? formatJson(returnValue) : null;

  const sectionLabel = (icon, label) => (
    <div className="mt-3 mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-secondary">
      {icon}
      <span>{label}</span>
    </div>
  );

  const title = (
    <div className="flex items-center gap-2 w-full">
      <div className="text-text-muted">
        <RiCodeSSlashLine className="w-4 h-4" />
      </div>
      <div className="text-xs text-text-primary">Code mode (Lua)</div>
      {timeout !== undefined && <Chip label={`timeout ${timeout}s`} className="!px-2 !py-0 !text-2xs" />}
      {isRunning ? (
        <CgSpinner className="animate-spin w-3 h-3 text-text-muted-light flex-shrink-0" />
      ) : result.isError ? (
        <Tooltip content={returnValue || result.text}>
          <RiErrorWarningFill className="w-3 h-3 text-error" />
        </Tooltip>
      ) : (
        <RiCheckboxCircleFill className="w-3 h-3 text-success flex-shrink-0" />
      )}
    </div>
  );

  const content = (
    <div className="px-3 pb-2 text-xs text-text-tertiary bg-bg-secondary">
      {sectionLabel(<RiCodeSSlashLine className="w-3 h-3 opacity-70" />, 'Script')}
      <CodeBlock baseDir={projectDir || ''} taskId={task?.id} language="lua" isComplete={true} className="text-2xs">
        {code}
      </CodeBlock>

      {hasStdout && (
        <>
          {sectionLabel(<RiTerminalBoxLine className="w-3 h-3 opacity-70" />, 'Output')}
          <CodeBlock
            baseDir={projectDir || ''}
            taskId={task?.id}
            language="plaintext"
            isComplete={true}
            className="max-h-64 overflow-y-auto text-2xs"
          >
            {stdout}
          </CodeBlock>
        </>
      )}

      {returnValue && (
        <>
          {sectionLabel(<RiArrowGoBackLine className="w-3 h-3 opacity-70" />, 'Return value')}
          {result.isError ? (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-primary-light p-3 font-mono text-2xs text-error scrollbar-thin scrollbar-track-bg-primary-light scrollbar-thumb-bg-secondary-light hover:scrollbar-thumb-bg-fourth">
              {returnValue}
            </pre>
          ) : returnJson !== null ? (
            <CodeBlock
              baseDir={projectDir || ''}
              taskId={task?.id}
              language="json"
              isComplete={true}
              className="max-h-64 overflow-y-auto text-2xs"
            >
              {returnJson}
            </CodeBlock>
          ) : (
            <CodeBlock
              baseDir={projectDir || ''}
              taskId={task?.id}
              language="plaintext"
              isComplete={true}
              className="max-h-64 overflow-y-auto text-2xs"
            >
              {returnValue}
            </CodeBlock>
          )}
        </>
      )}

      {isRunning && <div className="mt-3 text-2xs italic text-text-muted">Executing…</div>}

      {!isRunning && !hasStdout && !returnValue && <div className="mt-3 text-2xs italic text-text-muted">Execution completed with no output.</div>}
    </div>
  );

  return (
    <ExpandableMessageBlock
      message={message}
      title={title}
      content={content}
      usageReport={message.usageReport}
      initialExpanded={true}
      hideMessageBar={true}
    />
  );
}