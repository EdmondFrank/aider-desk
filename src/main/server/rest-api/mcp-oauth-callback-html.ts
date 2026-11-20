import fs from 'fs';

import startupIconPath from '../../../renderer/startup-icon.webp?asset';

const loadStartupIconDataUri = (): string | null => {
  try {
    const buffer = fs.readFileSync(startupIconPath);
    return `data:image/webp;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
};

const STARTUP_ICON_DATA_URI = loadStartupIconDataUri();

const SUCCESS_ICON_SVG =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5" opacity="0.35"/><path d="M6.25 10.25L8.75 12.75L13.75 7.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ERROR_ICON_SVG =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5" opacity="0.35"/><path d="M7.25 7.25L12.75 12.75M12.75 7.25L7.25 12.75" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';

const renderOAuthCallbackHtml = (options: { title: string; message: string; isError?: boolean }): string => {
  const { title, message, isError = false } = options;
  const accentColor = isError ? '#f87171' : '#34d399';
  const badgeBg = isError ? 'rgba(248, 113, 113, 0.12)' : 'rgba(52, 211, 153, 0.12)';
  const badgeBorder = isError ? 'rgba(248, 113, 113, 0.28)' : 'rgba(52, 211, 153, 0.28)';
  const statusIcon = isError ? ERROR_ICON_SVG : SUCCESS_ICON_SVG;
  const faviconTag = STARTUP_ICON_DATA_URI ? `<link rel="icon" type="image/webp" href="${STARTUP_ICON_DATA_URI}" />` : '';
  const logoTag = STARTUP_ICON_DATA_URI ? `<img class="logo" src="${STARTUP_ICON_DATA_URI}" width="104" height="104" alt="AiderDesk" />` : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AiderDesk — ${title}</title>
    ${faviconTag}
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      html,
      body {
        height: 100%;
      }
      body {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        padding: 24px;
        background:
          radial-gradient(1200px 600px at 50% 38%, rgba(59, 130, 246, 0.12), transparent 60%),
          radial-gradient(900px 500px at 50% 120%, rgba(37, 99, 235, 0.1), transparent 55%),
          #0b1120;
        color: #e5e7eb;
        font:
          16px system-ui,
          -apple-system,
          sans-serif;
        text-align: center;
        color-scheme: dark;
        animation: fade-in 0.4s ease-out both;
      }
      .logo {
        display: block;
        width: 104px;
        height: 104px;
        border-radius: 22px;
        filter: drop-shadow(0 12px 32px rgba(37, 99, 235, 0.35));
        animation: float 4s ease-in-out infinite;
      }
      .brand {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-top: -4px;
      }
      .brand-title {
        font-size: 24px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #f3f4f6;
      }
      .brand-tagline {
        font-size: 13px;
        color: #94a3b8;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        max-width: 400px;
        width: 100%;
        padding: 20px 24px;
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(148, 163, 184, 0.16);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
      }
      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        border-radius: 999px;
        background: ${badgeBg};
        border: 1px solid ${badgeBorder};
        color: ${accentColor};
        font-size: 15px;
        font-weight: 600;
      }
      .message {
        font-size: 14px;
        line-height: 1.5;
        color: #cbd5e1;
      }
      @keyframes fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes float {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        body,
        .logo {
          animation: none;
        }
      }
    </style>
  </head>
  <body>
    ${logoTag}
    <div class="brand">
      <div class="brand-title">AiderDesk</div>
      <div class="brand-tagline">AI Coding Assistant</div>
    </div>
    <main class="card" role="status">
      <h1 class="status-badge">${statusIcon}<span>${title}</span></h1>
      <p class="message">${message}</p>
    </main>
  </body>
</html>`;
};

export const OAUTH_SUCCESS_HTML = renderOAuthCallbackHtml({
  title: 'Authentication complete',
  message: 'You can close this window and return to AiderDesk.',
});

export const OAUTH_ERROR_HTML = renderOAuthCallbackHtml({
  title: 'Authentication failed',
  message: 'Return to AiderDesk and try connecting the MCP server again.',
  isError: true,
});
