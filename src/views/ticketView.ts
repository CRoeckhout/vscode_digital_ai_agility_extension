import * as vscode from 'vscode';
import { createApi } from '../agilityApi';

// Simple HTML escape to avoid injecting arbitrary HTML from ticket descriptions.
// Accepts any input (string, number, array, object) and converts to a safe string.
function escapeHtml(input: unknown): string {
  if (input === undefined || input === null) { return ''; }
  // If it's an array, join with comma and space for readability
  const raw = Array.isArray(input) ? (input as any[]).join(', ') : String(input);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br/>');
}

// Lightweight, safe markdown -> HTML converter.
// Strategy: escape HTML first, then parse line-by-line for code blocks, headings, lists and paragraphs,
// and apply simple inline transforms (links, inline code, bold, italic). Links are validated to avoid javascript: URIs.
function markdownToHtml(input: unknown): string {
  if (input === undefined || input === null) { return ''; }
  const text = Array.isArray(input) ? (input as any[]).join('\n') : String(input);
  // Work with the raw text but escape content when inserting into HTML elements.
  const lines = text.split(/\r?\n/);
  let out = '';
  let inList = false;
  let i = 0;

  const safeHref = (href: string) => {
    try {
      const u = href.trim();
      if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) { return u; }
    } catch {
      /* fallthrough */
    }
    return null;
  };

  const inlineTransform = (s: string) => {
    // escape HTML chars first
    let v = s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // links [text](url)
    v = v.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
      const ok = safeHref(href);
      if (ok) {
        return `<a href="${ok}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      return `${text}`;
    });

    // inline code `code`
    v = v.replace(/`([^`]+)`/g, (m, c) => `<code>${c.replace(/</g, '&lt;')}</code>`);

    // bold **text** then italic *text*
    v = v.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    v = v.replace(/\*(.*?)\*/g, '<em>$1</em>');

    return v;
  };

  while (i < lines.length) {
    let line = lines[i];
    // code block start
    if (/^```/.test(line)) {
      const lang = line.replace(/^```\s*/, '') || '';
      i++;
      let codeLines: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        // escape HTML inside code block
        codeLines.push(lines[i]);
        i++;
      }
      // skip closing ```
      i++;
      const codeHtml = codeLines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n');
      out += `<pre><code class="language-${escapeHtml(lang)}">${codeHtml}</code></pre>`;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out += `<h${level}>${inlineTransform(h[2])}</h${level}>`;
      i++;
      continue;
    }

    // list item
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${inlineTransform(li[1])}</li>`;
      i++;
      // continue accumulating list items
      // if next line is not a list item, we'll close the list in the next iteration
      const next = lines[i] || '';
      if (!/^[-*]\s+/.test(next)) { out += '</ul>'; inList = false; }
      continue;
    }

    // blank line
    if (line.trim() === '') {
      out += '';
      i++;
      continue;
    }

    // paragraph
    out += `<p>${inlineTransform(line)}</p>`;
    i++;
  }

  if (inList) { out += '</ul>'; }
  return out;
}

// Lightweight sanitizer for server-provided HTML. Removes script/style tags,
// strips event handler attributes (on*) and neuters javascript: and data: URLs.
function sanitizeHtml(rawInput: unknown): string {
  if (rawInput === undefined || rawInput === null) { return ''; }
  let s = String(rawInput);
  // Remove script/style blocks entirely
  s = s.replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  s = s.replace(/<\s*style[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/gi, '');
  // Remove javascript: or data: URIs in href/src
  s = s.replace(/\s(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, p1, p2) => {
    const val = (p2 || '').toString().replace(/^['"]|['"]$/g, '').trim();
    if (/^\s*javascript:/i.test(val) || /^\s*data:/i.test(val)) {
      return ` ${p1}="#"`;
    }
    // allow http(s), mailto, and root-relative paths
    if (/^\s*https?:\/\//i.test(val) || /^\s*mailto:/i.test(val) || /^\s*\/\//.test(val) || /^\s*\//.test(val)) {
      return ` ${p1}="${val}"`;
    }
    return ` ${p1}="#"`;
  });
  // Strip inline event handlers like onclick="..."
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return s;
}

export async function openTicketDetail(context: vscode.ExtensionContext, arg: any) {
    // arg is expected to be a TicketNode or a simple object containing assetId and url
    const assetId = (arg && typeof arg === 'object') ? (arg.assetId || arg.number || arg.id) : undefined;
    const url = (arg && typeof arg === 'object') ? (arg.url || undefined) : (typeof arg === 'string' ? arg : undefined);

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
            localResourceRoots: [context.extensionUri]
        }
    );

    panel.webview.html = getLoadingHtml();

    const config = vscode.workspace.getConfiguration('agility');
    const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
    const token = config.get<string>('accessToken');

    if (!baseUrl || !token) {
        panel.webview.html = getErrorHtml('Agility instance URL or access token not configured.');
        return;
    }

    async function render() {
        try {
            const api = await createApi(baseUrl!, token!, context);
            // Try PrimaryWorkitem first (works for Story/Defect/Request)
            const path = `/Data/PrimaryWorkitem/${assetId}`;
            const res = await api.get(path, { params: { select: 'Name,Number,Description,Status.Name,Owners.Name,Estimate,ToDo,Scope.Name,ChangeDate,AssetType' } });
            const asset = res.data;

            // transform attributes from the server shape to a flat map
            const attrs: Record<string, any> = {};
            if (asset && asset.Attributes) {
                for (const a of Object.values(asset.Attributes) as any[]) { attrs[a.name] = a.value; }
            }

      panel.title = `${attrs.Number || assetId}: ${attrs.Name || 'Ticket'}`;

      // Prepare description HTML: if server provided HTML, sanitize then fetch images
      // using the authenticated API and replace src with data URIs. Otherwise render markdown.
      let descriptionHtml = '';
      try {
        const rawDesc = attrs.Description || '';
        const s = String(rawDesc);
        if (/<\/?[a-z][\s\S]*>/i.test(s)) {
          // server provided HTML
          let processed = sanitizeHtml(s);

          // find all img src values
          const imgMatches = Array.from(processed.matchAll(/<img[^>]+src=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi))
            .map(m => m[1] || m[2] || m[3])
            .filter(Boolean);
          const unique = Array.from(new Set(imgMatches));

          const results = await Promise.allSettled(unique.map(async (src) => {
            try {
              if (/^\s*data:|^\s*blob:|^\s*javascript:/i.test(src)) { return { src, dataUri: src }; }
              // resolve relative URLs against baseUrl
              let absolute = src;
              try { absolute = new URL(src, baseUrl!).toString(); } catch { absolute = src; }
              const resImg = await api.get(absolute, { responseType: 'arraybuffer' });
              const contentType = resImg.headers['content-type'] || 'application/octet-stream';
              const b64 = Buffer.from(resImg.data, 'binary').toString('base64');
              return { src, dataUri: `data:${contentType};base64,${b64}` };
            } catch (err) {
              return { src, dataUri: null };
            }
          }));

          for (const r of results) {
            if (r.status === 'fulfilled') {
              const { src, dataUri } = r.value as any;
              if (dataUri) {
                // replace all occurrences of the original src with the dataUri
                processed = processed.split(src).join(dataUri);
              } else {
                // replace with a small SVG placeholder data URI
                const placeholder = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100%" height="100%" fill="#2d2d2d"/><text x="50%" y="50%" fill="#fff" font-family="Segoe UI" font-size="12" dominant-baseline="middle" text-anchor="middle">Image unavailable</text></svg>');
                processed = processed.split(src).join(placeholder);
              }
            }
          }

          descriptionHtml = processed;
        } else {
          descriptionHtml = markdownToHtml(s);
        }
      } catch (err) {
        descriptionHtml = escapeHtml(attrs.Description);
      }

      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
body{font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px;color:#ffffff;background:#1e1e1e}
.header{display:flex;align-items:center;justify-content:space-between}
.title{font-size:1.1rem;font-weight:600}
.meta{color:#bbb}
.section{margin-top:12px}
.actions button{margin-left:8px;background:#0e639c;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer}
.actions button:hover{filter:brightness(1.05)}
.description{white-space:pre-wrap;background:#252526;padding:12px;border-radius:6px;color:#ddd}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="title">${escapeHtml(attrs.Number ? `${attrs.Number}: ${attrs.Name}` : (attrs.Name || String(assetId)))}</div>
    <div class="meta">${escapeHtml(attrs['Status.Name'] || '—')} • ${escapeHtml(attrs['Scope.Name'] || '')} • Updated: ${escapeHtml(attrs.ChangeDate)}</div>
  </div>
  <div class="actions">
    <button id="open">Open in browser</button>
    <button id="copy">Copy URL</button>
    <button id="refresh">Refresh</button>
  </div>
</div>
<div class="section">
  <strong>Assignees</strong>: ${escapeHtml((attrs['Owners.Name'] || 'Unassigned'))}
</div>
<div class="section">
  <strong>Estimate</strong>: ${escapeHtml(String(attrs.Estimate ?? '—'))} &nbsp; <strong>To Do</strong>: ${escapeHtml(String(attrs.ToDo ?? '—'))}
</div>
  <div class="section">
  <strong>Description</strong>
  <div class="description">${descriptionHtml}</div>
</div>
<script>
const vscode = acquireVsCodeApi();
document.getElementById('open').addEventListener('click', () => { vscode.postMessage({ type: 'openInBrowser' }); });
document.getElementById('copy').addEventListener('click', () => { vscode.postMessage({ type: 'copyUrl' }); });
document.getElementById('refresh').addEventListener('click', () => { vscode.postMessage({ type: 'refresh' }); });
// handle messages from extension
window.addEventListener('message', event => {
  const msg = event.data;
  if (msg?.type === 'error') {
    document.body.innerHTML = '<h3 style="color:crimson">'+(msg.message||'Error')+'</h3>';
  }
});
</script>
</body>
</html>`;

            panel.webview.html = html;

        } catch (err: any) {
            const message = err?.response?.data || err?.message || String(err);
            panel.webview.html = getErrorHtml(String(message));
        }
    }

    // initial render
    await render();

  panel.webview.onDidReceiveMessage(async (m) => {
    if (m?.type === 'openInBrowser') {
      if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
      else {
        // fallback to opening asset detail page on instance
        const detail = `${baseUrl}/assetDetail.v1?oid=PrimaryWorkitem:${assetId}`;
        vscode.env.openExternal(vscode.Uri.parse(detail));
      }
    }

    if (m?.type === 'copyUrl') {
      const detail = url || `${baseUrl}/assetDetail.v1?oid=PrimaryWorkitem:${assetId}`;
      try {
        await vscode.env.clipboard.writeText(detail);
        vscode.window.showInformationMessage('Ticket URL copied to clipboard.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to copy URL: ${err?.message || String(err)}`);
      }
    }

    if (m?.type === 'refresh') {
      panel.webview.html = getLoadingHtml();
      await render();
    }
  }, undefined, context.subscriptions);
}

function getLoadingHtml() {
    return `<!doctype html><html><body style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px"><h3>Loading...</h3></body></html>`;
}

function getErrorHtml(msg: string) {
    return `<!doctype html><html><body style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px"><h3 style="color:crimson">${escapeHtml(msg)}</h3></body></html>`;
}
