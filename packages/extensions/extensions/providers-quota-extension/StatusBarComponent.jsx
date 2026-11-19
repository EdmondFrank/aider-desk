({ agentProfile, data, ui }) => {
  const formatResetTime = (timestamp) => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const currencySymbols = {
    USD: '$',
    CNY: '¥',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    KRW: '₩',
  };

  const formatCurrency = (amount, currency) => {
    const symbol = currencySymbols[currency] || currency;
    return `${symbol}${amount}`;
  };

  if (agentProfile?.provider === 'synthetic' && data?.synthetic) {
    return data.synthetic.error ? (
      <span className="pt-1">Quota unavailable</span>
    ) : (
      <div className="flex items-center gap-2 pt-1 justify-between w-full">
        <span>Usage:</span>
        <div className="flex items-center gap-2">
          <span>{data.synthetic.used}/{data.synthetic.limit}</span>
          <span>({data.synthetic.percentage}%)</span>
        </div>
      </div>
    );
  }

  if (agentProfile?.provider === 'zai-plan' && data?.zai) {
    return (
      <div className="flex items-center gap-2 pt-1 justify-between w-full">
        <span>Usage:</span>
        <div className="flex items-center gap-2">
          <ui.Tooltip content={data.zai.hourlyNextResetTime ? `Resets at ${formatResetTime(data.zai.hourlyNextResetTime)}` : ''}>
            <span>5 Hours: {data.zai.hourlyPercentage}%</span>
          </ui.Tooltip>
          <span>|</span>
          <ui.Tooltip content={data.zai.weeklyNextResetTime ? `Resets at ${formatResetTime(data.zai.weeklyNextResetTime)}` : ''}>
            <span>Weekly: {data.zai.weeklyPercentage}%</span>
          </ui.Tooltip>
        </div>
      </div>
    );
  }

  if (agentProfile?.provider === 'deepseek' && data?.deepseek) {
    const ds = data.deepseek;
    const balance = ds.balance;

    if (!balance) {
      return (
        <div className="flex items-center gap-2 pt-1 justify-between w-full">
          <span>DeepSeek:</span>
          <span>Balance unavailable</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 pt-1 justify-between w-full">
        <span>DeepSeek:</span>
        <div className="flex items-center gap-2">
          <span>{formatCurrency(balance.total_balance, balance.currency)}</span>
        </div>
      </div>
    );
  }

  if (agentProfile?.provider === 'opencode-go' && data?.opencodeGo) {
    const go = data.opencodeGo;

    const renderWindow = (label, usageWindow) => (
      <ui.Tooltip content={usageWindow.resetTime ? `Resets at ${formatResetTime(usageWindow.resetTime)}` : ''}>
        <span className={usageWindow.rateLimited ? 'text-red-400' : undefined}>
          {label}: {usageWindow.percentage}%
        </span>
      </ui.Tooltip>
    );

    return (
      <div className="flex items-center gap-2 pt-1 justify-end w-full">
        <div className="flex items-center gap-2">
          {renderWindow('5 Hours', go.rolling)}
          <span>|</span>
          {renderWindow('Weekly', go.weekly)}
          <span>|</span>
          {renderWindow('Monthly', go.monthly)}
        </div>
      </div>
    );
  }

  if (agentProfile?.provider === 'llmapi' && data?.llmapi) {
    const lm = data.llmapi;
    return (
      <div className="flex items-center gap-2 pt-1 justify-between w-full">
        <span>Credits:</span>
        <div className="flex items-center gap-2">
          <ui.Tooltip content={lm.monthlyCap ? `Monthly: $${lm.monthlyCap.used.toFixed(2)} / $${lm.monthlyCap.limit.toFixed(2)}` : ''}>
            <span>{formatCurrency(lm.totalCredits.toFixed(2), lm.currency)}</span>
          </ui.Tooltip>
          {lm.monthlyCap ? (
            <ui.Tooltip content={`Monthly: $${lm.monthlyCap.used.toFixed(2)} / $${lm.monthlyCap.limit.toFixed(2)}`}>
              <span>({Math.round((lm.monthlyCap.used / lm.monthlyCap.limit) * 100)}%)</span>
            </ui.Tooltip>
          ) : null}
        </div>
      </div>
    );
  }

  if (agentProfile?.provider === 'neuralwatt' && data?.neuralwatt) {
    const nw = data.neuralwatt;
    const freeEnergy = nw.dailyFreeEnergy;
    const formatWh = (kwh) => (kwh * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
    const periodEnd = formatResetTime(nw.currentPeriodEnd);

    return (
      <div className="flex flex-wrap items-center justify-end gap-x-2 pt-1 w-full">
        {freeEnergy && (
          <>
            <ui.Tooltip content={`Resets at ${formatResetTime(freeEnergy.reset_at)} · Covered models: ${freeEnergy.model_labels.join(', ')}`}>
              <span>Daily free energy: {formatWh(freeEnergy.kwh_remaining)}/{formatWh(freeEnergy.kwh_included)} Wh</span>
            </ui.Tooltip>
            <span aria-hidden="true">|</span>
          </>
        )}
        {nw.isSubscription ? (
          <div className="flex items-center gap-2">
            <ui.Tooltip content={periodEnd ? `Renews at ${periodEnd}` : ''}>
              <span>Usage: {nw.kwhUsed?.toFixed(2) ?? '0.00'}/{nw.kwhIncluded?.toFixed(1) ?? '0.0'} kWh</span>
            </ui.Tooltip>
            <span>({nw.kwhPercentage}%)</span>
            {nw.inOverage && <span className="text-red-400 text-xs">overage</span>}
          </div>
        ) : (
          <ui.Tooltip content={`Accounting: ${nw.accountingMethod || 'energy'}`}>
            <span>Credits: ${nw.creditsRemaining?.toFixed(2) ?? '0.00'}</span>
          </ui.Tooltip>
        )}
      </div>
    );
  }

  return null;
}
