({ message, ui, icons, libraries, executeExtensionAction }) => {
  const { RiErrorWarningLine, RiLoader4Line, RiSparkling2Line } = icons.Ri;

  const webCore = libraries?.a2uiWebCore;
  const markdownLib = libraries?.a2uiMarkdown;
  const parsedMessages = React.useMemo(() => {
    const raw = message?.args?.messages;
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  }, [message]);

  const [error, setError] = React.useState(null);
  const [rootNode, setRootNode] = React.useState(null);
  const containerRef = React.useRef(null);
  const rootNodeRef = React.useRef(null);
  const processorRef = React.useRef(null);
  const actionHandlerRef = React.useRef(null);

  actionHandlerRef.current = (action) => {
    let dataModel;
    try {
      dataModel = processorRef.current?.getSurface?.(action.surfaceId)?.dataModel?.get?.('/');
    } catch (e) {
      dataModel = undefined;
    }
    Promise.resolve(
      executeExtensionAction('a2ui-action', JSON.parse(JSON.stringify({ ...action, dataModel }))),
    ).then((result) => {
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        console.warn('[a2ui] action rejected by extension:', result.error);
      }
    });
  };

  React.useEffect(() => {
    if (!webCore || !parsedMessages) {
      return undefined;
    }
    let cancelled = false;
    let unsubscribeRoot = null;
    let processor = null;
    try {
      if (markdownLib?.renderMarkdown && typeof webCore.setMarkdownRenderer === 'function') {
        webCore.setMarkdownRenderer(markdownLib.renderMarkdown);
      }
      if (typeof webCore.injectBasicCatalogStyles === 'function') {
        webCore.injectBasicCatalogStyles();
      }
      const componentImpls = [];
      const catalogComponents = webCore.basicCatalog?.components;
      if (catalogComponents) {
        if (typeof catalogComponents.forEach === 'function') {
          catalogComponents.forEach((impl) => componentImpls.push(impl));
        } else {
          Object.values(catalogComponents).forEach((impl) => componentImpls.push(impl));
        }
      }
      const knownTags = componentImpls
        .map((impl) => (impl && typeof impl.tagName === 'string' ? impl.tagName : null))
        .filter(Boolean);
      const needsRegistration =
        knownTags.length > 0 && knownTags.every((tagName) => !customElements.get(tagName));
      if (needsRegistration) {
        componentImpls.forEach((component) => webCore.registerUniversalElement(component));
      }
      processor = new webCore.MessageProcessor([webCore.basicCatalog], (action) => actionHandlerRef.current(action));
      processorRef.current = processor;
      const created = [];
      processor.onSurfaceCreated((surface) => created.push(surface));
      processor.processMessages(parsedMessages);
      const surface = created[0] ?? processor.getSurface?.(parsedMessages[0]?.createSurface?.surfaceId);
      if (!surface) {
        setError('No surface was created by the A2UI messages.');
        return undefined;
      }
      const resolver = new webCore.NodeResolver(surface);
      const stopEffect = webCore.effect(() => {
        const resolved = webCore.getValue(resolver.rootNode);
        if (!cancelled) {
          setRootNode(resolved ?? null);
        }
      });
      unsubscribeRoot = () => {
        stopEffect();
        resolver.dispose();
      };
    } catch (e) {
      setError(e?.message ?? String(e));
    }
    return () => {
      cancelled = true;
      unsubscribeRoot?.();
      processorRef.current = null;
      try {
        processor?.dispose?.();
      } catch (e) {
        // surface cleanup is best-effort
      }
    };
  }, [webCore, markdownLib, parsedMessages]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !rootNode || !rootNode.impl?.tagName) {
      return;
    }
    if (rootNodeRef.current === rootNode) {
      return;
    }
    container.replaceChildren();
    const element = document.createElement(rootNode.impl.tagName);
    element.node = rootNode;
    rootNodeRef.current = rootNode;
    container.appendChild(element);
  }, [rootNode]);

  if (!webCore) {
    return React.createElement(
      'div',
      { className: 'flex items-center gap-2 text-text-tertiary text-sm' },
      React.createElement(RiLoader4Line, { className: 'w-4 h-4 animate-spin' }),
      'Loading A2UI renderer...',
    );
  }
  if (error) {
    return React.createElement(
      'div',
      { className: 'flex items-center gap-2 text-text-tertiary text-sm' },
      React.createElement(RiErrorWarningLine, { className: 'w-4 h-4' }),
      React.createElement('span', null, 'A2UI card failed to render: ' + error),
    );
  }
  if (!parsedMessages) {
    return React.createElement(
      'div',
      { className: 'flex items-center gap-2 text-text-tertiary text-sm' },
      React.createElement(RiSparkling2Line, { className: 'w-4 h-4' }),
      React.createElement('span', null, 'A2UI card (content unavailable)'),
    );
  }

  const themeStyle = {
    '--a2ui-color-background': 'var(--color-bg-primary)',
    '--a2ui-color-on-background': 'var(--color-text-primary)',
    '--a2ui-color-surface': 'var(--color-bg-secondary)',
    '--a2ui-color-on-surface': 'var(--color-text-primary)',
    '--a2ui-color-primary': 'var(--color-accent-primary)',
    '--a2ui-color-on-primary': 'var(--color-button-primary-text, #ffffff)',
    '--a2ui-color-primary-hover': 'var(--color-accent-light)',
    '--a2ui-color-secondary': 'var(--color-bg-fourth)',
    '--a2ui-color-secondary-hover': 'var(--color-bg-fourth-emphasis)',
    '--a2ui-color-on-secondary': 'var(--color-text-secondary)',
    '--a2ui-color-border': 'var(--color-border-default)',
    '--a2ui-color-input': 'var(--color-bg-tertiary)',
    '--a2ui-color-on-input': 'var(--color-text-primary)',
    '--a2ui-border-radius': '8px',
    '--a2ui-font-size': '0.8125rem',
    '--a2ui-font-size-m': 'var(--a2ui-font-size)',
    '--a2ui-font-size-s': 'calc(var(--a2ui-font-size-m) / var(--a2ui-font-scale))',
    '--a2ui-font-size-xs': 'calc(var(--a2ui-font-size-s) / var(--a2ui-font-scale))',
    '--a2ui-font-size-l': 'calc(var(--a2ui-font-size-m) * var(--a2ui-font-scale))',
    '--a2ui-font-size-xl': 'calc(var(--a2ui-font-size-l) * var(--a2ui-font-scale))',
    '--a2ui-font-size-2xl': 'calc(var(--a2ui-font-size-xl) * var(--a2ui-font-scale))',
  };

  return React.createElement(
    'div',
    { style: themeStyle, className: 'my-1 not-prose w-full' },
    React.createElement('div', {
      ref: containerRef,
      style: { width: '100%' },
    }),
  );
};
