/**
 * HTML utilities for escaping, sanitizing, and converting markdown to HTML.
 * Centralized to avoid duplication across providers.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Accepts any input type and converts to a safe string.
 */
export function escapeHtml(input: unknown): string {
  if (input === undefined || input === null) {
    return '';
  }
  const raw = Array.isArray(input) ? (input as unknown[]).join(', ') : String(input);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes HTML and converts newlines to <br/> tags.
 */
export function escapeHtmlWithBreaks(input: unknown): string {
  return escapeHtml(input).replace(/\r?\n/g, '<br/>');
}

/**
 * Validates a URL to ensure it's safe (http, https, or mailto).
 * Returns the URL if valid, null otherwise.
 */
function safeHref(href: string): string | null {
  try {
    const u = href.trim();
    if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) {
      return u;
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Transforms inline markdown elements (links, code, bold, italic).
 * Escapes HTML first for safety.
 */
function inlineTransform(s: string): string {
  let v = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Links [text](url)
  v = v.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, href: string) => {
    const validUrl = safeHref(href);
    if (validUrl) {
      return `<a href="${validUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    return text;
  });

  // Inline code `code`
  v = v.replace(/`([^`]+)`/g, (_match, code: string) => 
    `<code>${code.replace(/</g, '&lt;')}</code>`
  );

  // Bold **text** then italic *text*
  v = v.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  v = v.replace(/\*(.*?)\*/g, '<em>$1</em>');

  return v;
}

/**
 * Converts lightweight markdown to HTML.
 * Handles code blocks, headings, lists, and paragraphs.
 * Applies inline transforms for links, code, bold, and italic.
 */
export function markdownToHtml(input: unknown): string {
  if (input === undefined || input === null) {
    return '';
  }
  const text = Array.isArray(input) ? (input as unknown[]).join('\n') : String(input);
  const lines = text.split(/\r?\n/);
  let out = '';
  let inList = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block start
    if (/^```/.test(line)) {
      const lang = line.replace(/^```\s*/, '') || '';
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      const codeHtml = codeLines
        .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
        .join('\n');
      out += `<pre><code class="language-${escapeHtml(lang)}">${codeHtml}</code></pre>`;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out += `<h${level}>${inlineTransform(headingMatch[2])}</h${level}>`;
      i++;
      continue;
    }

    // List item
    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        out += '<ul>';
        inList = true;
      }
      out += `<li>${inlineTransform(listMatch[1])}</li>`;
      i++;
      const next = lines[i] || '';
      if (!/^[-*]\s+/.test(next)) {
        out += '</ul>';
        inList = false;
      }
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    out += `<p>${inlineTransform(line)}</p>`;
    i++;
  }

  if (inList) {
    out += '</ul>';
  }

  return out;
}

/**
 * Sanitizes server-provided HTML by removing dangerous elements.
 * - Removes script and style tags
 * - Neutralizes javascript: and data: URLs
 * - Strips inline event handlers (onclick, etc.)
 */
export function sanitizeHtml(rawInput: unknown): string {
  if (rawInput === undefined || rawInput === null) {
    return '';
  }
  let s = String(rawInput);

  // Remove script/style blocks entirely
  s = s.replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  s = s.replace(/<\s*style[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/gi, '');

  // Remove javascript: or data: URIs in href/src
  s = s.replace(
    /\s(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (_match, attr: string, rawValue: string) => {
      const val = rawValue.replace(/^['"]|['"]$/g, '').trim();
      if (/^\s*javascript:/i.test(val) || /^\s*data:/i.test(val)) {
        return ` ${attr}="#"`;
      }
      // Allow http(s), mailto, and root-relative paths
      if (
        /^\s*https?:\/\//i.test(val) ||
        /^\s*mailto:/i.test(val) ||
        /^\s*\/\//.test(val) ||
        /^\s*\//.test(val)
      ) {
        return ` ${attr}="${val}"`;
      }
      return ` ${attr}="#"`;
    }
  );

  // Strip inline event handlers like onclick="..."
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  return s;
}
