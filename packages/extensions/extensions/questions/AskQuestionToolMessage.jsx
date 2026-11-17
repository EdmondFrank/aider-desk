({ message, ui, icons }) => {
  const { ExpandableMessageBlock } = ui;
  const { CgSpinner } = icons.Cg;
  const { RiQuestionLine, RiCheckboxCircleFill, RiCloseCircleLine, RiErrorWarningFill } = icons.Ri;

  const parseResult = (value, depth = 0) => {
    if (depth > 6 || value == null) return {};
    if (typeof value === 'string') {
      try {
        return parseResult(JSON.parse(value), depth + 1);
      } catch {
        return { error: value };
      }
    }
    if (typeof value !== 'object') return {};
    if (value.isError || value.type === 'error-json' || value.type === 'error-text') {
      return { error: typeof value.value === 'string' ? value.value : JSON.stringify(value) };
    }
    if (typeof value.answer === 'string' || value.cancelled === true) return value;
    if (Array.isArray(value)) {
      const parts = value.map((part) => parseResult(part, depth + 1));
      return parts.find((part) => typeof part.answer === 'string' || part.cancelled === true) || parts.find((part) => part.error) || {};
    }
    if (value.type === 'text') return parseResult(value.text ?? value.value, depth + 1);
    if ('value' in value) return parseResult(value.value, depth + 1);
    if ('content' in value) return parseResult(value.content, depth + 1);
    return {};
  };

  const result = parseResult(message.content);
  const args = message.args || {};
  const question = typeof args.question === 'string' ? args.question : 'Ask question';
  const options = Array.isArray(args.options) ? args.options.filter((option) => typeof option === 'string') : [];
  const waiting = !message.content && !message.finished;
  const cancelled = result.cancelled === true;
  const answered = !result.error && typeof result.answer === 'string';
  const status = waiting ? 'Waiting for answer' : cancelled ? 'Cancelled' : answered ? 'Answered' : 'Error';
  const StatusIcon = waiting ? CgSpinner : cancelled ? RiCloseCircleLine : answered ? RiCheckboxCircleFill : RiErrorWarningFill;
  const statusClass = waiting ? 'animate-spin text-text-muted-light' : cancelled ? 'text-text-muted' : answered ? 'text-success' : 'text-error';

  const title = (
    <div className="flex items-center gap-2 w-full min-w-0">
      <RiQuestionLine className="w-4 h-4 text-text-muted flex-shrink-0" />
      <span className="text-xs text-text-primary flex-shrink-0">Ask question</span>
      <span className="text-xs text-text-secondary truncate flex-1 min-w-0">{question}</span>
      <StatusIcon className={`w-3 h-3 flex-shrink-0 ${statusClass}`} aria-label={status} />
    </div>
  );

  const isCustomAnswer = answered && !options.includes(result.answer);

  const content = (
    <div className="px-3 pb-3 text-xs bg-bg-secondary flex flex-col gap-2">
      <ul className="flex flex-col gap-1" aria-label="Answer options">
        {options.map((option, index) => (
          <li
            key={`${index}-${option}`}
            className={answered && option === result.answer ? 'rounded p-2 bg-accent-primary/10 text-success' : 'rounded p-2 text-text-secondary'}
          >
            <span className="whitespace-pre-wrap break-words">{option}</span>
            {answered && option === result.answer && <span className="ml-2 font-medium">(Selected)</span>}
          </li>
        ))}
      </ul>
      {waiting && <p className="text-text-muted">Waiting for your selection above the prompt field.</p>}
      {isCustomAnswer && <p className="text-success whitespace-pre-wrap break-words">Custom answer: {result.answer}</p>}
      {cancelled && (
        <p className="text-text-muted whitespace-pre-wrap break-words">{typeof result.reason === 'string' ? result.reason : 'Question cancelled.'}</p>
      )}
      {!waiting && !cancelled && !answered && (
        <pre className="text-error whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {result.error || message.content || 'Question finished without an answer.'}
        </pre>
      )}
    </div>
  );

  return (
    <ExpandableMessageBlock message={message} title={title} content={content} usageReport={message.usageReport} initialExpanded={false} hideMessageBar={true} />
  );
};
