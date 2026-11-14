({ data, task, agentProfile, ui, icons, executeExtensionAction }) => {
  const { useEffect, useState } = React;
  const [dismissedAt, setDismissedAt] = useState(null);
  const [actionFailed, setActionFailed] = useState(false);
  const { Button } = ui;
  const Spinner = icons.Cg.CgSpinner;

  useEffect(() => {
    if (!task) return;
    setActionFailed(false);
    executeExtensionAction('initialize').catch(() => setActionFailed(true));
  }, [task?.id, agentProfile?.id, agentProfile?.includeRepoMap, executeExtensionAction]);

  useEffect(() => {
    if (data?.status !== 'ready' || !data.completedAt) return;
    const timeout = setTimeout(() => setDismissedAt(data.completedAt), Math.max(0, 3000 - (Date.now() - data.completedAt)));
    return () => clearTimeout(timeout);
  }, [data?.status, data?.completedAt]);

  if (!agentProfile?.includeRepoMap || (!data && !actionFailed)) return null;
  if (data?.status === 'ready' && (dismissedAt === data.completedAt || Date.now() - data.completedAt >= 3000)) return null;

  const messages = {
    initializingTitle: 'Initializing repository map…',
    initializingDescription: 'Large projects may take a few minutes. You can keep writing your prompt.',
    waitingTitle: 'Agent is waiting for the repository map…',
    waitingDescription: 'Initialization time depends on project size. Continue in the background to start this run without a repository map.',
    backgroundDescription: 'Initialization continues in the background. This run will not include a repository map.',
    readyTitle: 'Repository map ready',
    readyDescription: 'The repository map is available for subsequent runs.',
    cancelledTitle: 'Repository map initialization cancelled',
    cancelledDescription: 'Runs will continue without a repository map until you retry initialization.',
    errorTitle: 'Repository map initialization failed',
    errorDescription: 'Runs can continue without a repository map. Retry initialization when you are ready.',
    cancelTooltip: 'Cancels initialization for all tasks using this checkout. Waiting runs continue without a map.',
  };
  const status = actionFailed ? 'error' : data.status;
  const initializing = status === 'initializing';
  const title = messages[initializing && data.waiting ? 'waitingTitle' : `${status}Title`];
  const description = initializing
    ? messages[data.waiting ? 'waitingDescription' : data.background ? 'backgroundDescription' : 'initializingDescription']
    : messages[`${status}Description`];

  const runAction = async (action) => {
    setActionFailed(false);
    try {
      await executeExtensionAction(action, data?.key);
    } catch {
      setActionFailed(true);
    }
  };

  const handleBackground = () => runAction('background');
  const handleCancel = () => runAction('cancel');
  const handleRetry = () => runAction('retry');

  return (
    <div role="status" aria-live="polite" className="mb-2 flex w-full items-center gap-3 rounded border border-border-dark-light bg-bg-secondary p-3 text-xs">
      {initializing && <Spinner className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-text-secondary" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text-primary">{title}</div>
        <div className="mt-1 text-text-secondary">{description}</div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {initializing && data.waiting && (
          <Button size="xs" variant="outline" onClick={handleBackground}>
            Continue without map
          </Button>
        )}
        {initializing && (
          <Button size="xs" variant="text" tooltip={messages.cancelTooltip} onClick={handleCancel}>
            Cancel
          </Button>
        )}
        {(status === 'cancelled' || status === 'error') && (
          <Button size="xs" variant="outline" onClick={handleRetry}>
            Retry initialization
          </Button>
        )}
      </div>
    </div>
  );
};
