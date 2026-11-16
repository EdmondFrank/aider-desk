({ data, executeExtensionAction, ui }) => {
  const { Button } = ui;

  if (!data) return null;

  const handleAnswer = (event) => {
    executeExtensionAction('answer', data.id, event.currentTarget.value);
  };

  const handleCancel = () => {
    executeExtensionAction('cancel', data.id);
  };

  return (
    <section aria-label="Agent question" className="w-full bg-accent-primary/10 border border-border-dark-light rounded-lg p-3 mb-2">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{data.question}</p>
        <Button onClick={handleCancel} size="xs" color="tertiary" variant="text">
          Dismiss
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {data.options.map((option) => (
          <Button
            key={option}
            value={option}
            onClick={handleAnswer}
            size="sm"
            color="tertiary"
            variant="outline"
            className="text-left whitespace-pre-wrap break-words"
          >
            {option}
          </Button>
        ))}
      </div>
    </section>
  );
};
