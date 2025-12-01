/**
 * Ticket detail panel provider.
 * Shows detailed information for a single ticket in a webview panel.
 */

import * as vscode from 'vscode';
import { fetchTicketDetail, fetchImageAsDataUri } from '../api';
import { getValidatedConfig } from '../config';
import { getErrorMessage } from '../errors';
import { escapeHtml, markdownToHtml, sanitizeHtml } from '../utils';

/**
 * Opens a ticket detail panel.
 * 
 * @param context The extension context
 * @param arg The ticket argument (can be object with assetId/url or string URL)
 */
export async function openTicketDetail(
  context: vscode.ExtensionContext,
  arg: unknown
): Promise<void> {
  const ticketArg = arg as { assetId?: string; number?: string; id?: string; url?: string } | string | undefined;
  
  const assetId = (ticketArg && typeof ticketArg === 'object')
    ? (ticketArg.assetId || ticketArg.number || ticketArg.id)
    : undefined;
  
  const url = (ticketArg && typeof ticketArg === 'object')
    ? ticketArg.url
    : (typeof ticketArg === 'string' ? ticketArg : undefined);

  if (!assetId && !url) {
    vscode.window.showWarningMessage('No ticket id or URL provided to open details.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'agility.ticketDetail',
    `Ticket ${assetId || url}`,
    { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
    {
      enableScripts: true,
      localResourceRoots: [context.extensionUri],
    }
  );

  panel.webview.html = getLoadingHtml();

  let instanceUrl: string;
  try {
    const config = getValidatedConfig();
    instanceUrl = config.instanceUrl;
  } catch (error) {
    panel.webview.html = getErrorHtml('Agility instance URL or access token not configured.');
    return;
  }

  const render = async (): Promise<void> => {
    try {
      const attrs = await fetchTicketDetail(context, assetId!);

      panel.title = `${attrs.Number || assetId}: ${attrs.Name || 'Ticket'}`;

      // Process description HTML
      const descriptionHtml = await processDescription(context, attrs.Description, instanceUrl);

      panel.webview.html = getTicketHtml(attrs, assetId!, descriptionHtml);
    } catch (error) {
      panel.webview.html = getErrorHtml(getErrorMessage(error));
    }
  };

  // Initial render
  await render();

  // Handle webview messages
  panel.webview.onDidReceiveMessage(
    async (message: { type: string }) => {
      if (message.type === 'openInBrowser') {
        const detailUrl = url || `${instanceUrl}/assetDetail.v1?oid=PrimaryWorkitem:${assetId}`;
        vscode.env.openExternal(vscode.Uri.parse(detailUrl));
      }

      if (message.type === 'copyUrl') {
        const detailUrl = url || `${instanceUrl}/assetDetail.v1?oid=PrimaryWorkitem:${assetId}`;
        try {
          await vscode.env.clipboard.writeText(detailUrl);
          vscode.window.showInformationMessage('Ticket URL copied to clipboard.');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to copy URL: ${getErrorMessage(error)}`);
        }
      }

      if (message.type === 'refresh') {
        panel.webview.html = getLoadingHtml();
        await render();
      }
    },
    undefined,
    context.subscriptions
  );
}

/**
 * Processes the description, converting markdown or sanitizing HTML.
 * Also fetches and embeds images as data URIs.
 */
async function processDescription(
  context: vscode.ExtensionContext,
  description: unknown,
  baseUrl: string
): Promise<string> {
  if (!description) {
    return '';
  }

  const rawDesc = String(description);

  // Check if it's HTML
  if (/<\/?[a-z][\s\S]*>/i.test(rawDesc)) {
    let processed = sanitizeHtml(rawDesc);

    // Find all img src values
    const imgMatches = Array.from(
      processed.matchAll(/<img[^>]+src=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)
    )
      .map((m) => m[1] || m[2] || m[3])
      .filter(Boolean);

    const uniqueImages = Array.from(new Set(imgMatches));

    // Fetch images and convert to data URIs
    const results = await Promise.allSettled(
      uniqueImages.map(async (src) => {
        if (/^\s*data:|^\s*blob:|^\s*javascript:/i.test(src)) {
          return { src, dataUri: src };
        }
        const dataUri = await fetchImageAsDataUri(context, src);
        return { src, dataUri };
      })
    );

    // Replace image sources with data URIs
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { src, dataUri } = result.value;
        if (dataUri) {
          processed = processed.split(src).join(dataUri);
        } else {
          // Replace with placeholder
          const placeholder = getImagePlaceholder();
          processed = processed.split(src).join(placeholder);
        }
      }
    }

    return processed;
  }

  // Convert markdown to HTML
  return markdownToHtml(rawDesc);
}

/**
 * Returns a placeholder SVG for unavailable images.
 */
function getImagePlaceholder(): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
    '<rect width="100%" height="100%" fill="#2d2d2d"/>' +
    '<text x="50%" y="50%" fill="#fff" font-family="Segoe UI" font-size="12" ' +
    'dominant-baseline="middle" text-anchor="middle">Image unavailable</text></svg>'
  );
}

/**
 * Generates the loading HTML.
 */
function getLoadingHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      color: #ffffff;
      background: #1e1e1e;
    }
  </style>
</head>
<body>
  <h3>Loading...</h3>
</body>
</html>`;
}

/**
 * Generates the error HTML.
 */
function getErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      color: #ffffff;
      background: #1e1e1e;
    }
    .error {
      color: crimson;
    }
  </style>
</head>
<body>
  <h3 class="error">${escapeHtml(message)}</h3>
</body>
</html>`;
}

/**
 * Generates the ticket detail HTML.
 */
function getTicketHtml(
  attrs: Record<string, unknown>,
  assetId: string,
  descriptionHtml: string
): string {
  const title = attrs.Number
    ? `${attrs.Number}: ${attrs.Name}`
    : (attrs.Name || String(assetId));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      color: #ffffff;
      background: #1e1e1e;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .title {
      font-size: 1.1rem;
      font-weight: 600;
    }
    .meta {
      color: #bbb;
    }
    .section {
      margin-top: 12px;
    }
    .actions button {
      margin-left: 8px;
      background: #0e639c;
      color: #fff;
      border: none;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
    }
    .actions button:hover {
      filter: brightness(1.05);
    }
    .description {
      white-space: pre-wrap;
      background: #252526;
      padding: 12px;
      border-radius: 6px;
      color: #ddd;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="meta">${escapeHtml(attrs['Status.Name'] || '—')} • ${escapeHtml(attrs['Scope.Name'] || '')} • Updated: ${escapeHtml(attrs.ChangeDate)}</div>
    </div>
    <div class="actions">
      <button id="open">Open in browser</button>
      <button id="copy">Copy URL</button>
      <button id="refresh">Refresh</button>
    </div>
  </div>
  <div class="section">
    <strong>Assignees</strong>: ${escapeHtml(attrs['Owners.Name'] || 'Unassigned')}
  </div>
  <div class="section">
    <strong>Estimate</strong>: ${escapeHtml(String(attrs.Estimate ?? '—'))} &nbsp;
    <strong>To Do</strong>: ${escapeHtml(String(attrs.ToDo ?? '—'))}
  </div>
  <div class="section">
    <strong>Description</strong>
    <div class="description">${descriptionHtml}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ type: 'openInBrowser' });
    });
    document.getElementById('copy').addEventListener('click', () => {
      vscode.postMessage({ type: 'copyUrl' });
    });
    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
  </script>
</body>
</html>`;
}
