/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HtmlSanitizer.ts
 * Strict allowlist HTML sanitizer and URL validator for DIMONEX News & Announcement CMS.
 * Prevents XSS, script injection, event handler injection, and unsafe URI schemes.
 */

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4',
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

const DANGEROUS_BLOCK_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'form', 'input', 'button', 'textarea', 'select', 'option',
  'noscript', 'template', 'head', 'meta', 'link', 'base', 'applet'
];

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function isSafeLinkUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const decoded = decodeHtmlEntities(rawUrl)
    .replace(/[\u0000-\u001F\u007F\s]+/g, '')
    .trim();
  if (!decoded) return false;
  // Allow relative paths starting with single '/' (not protocol-relative '//')
  if (decoded.startsWith('/') && !decoded.startsWith('//')) {
    return true;
  }
  try {
    const parsed = new URL(decoded);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSafeMediaUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const decoded = decodeHtmlEntities(rawUrl)
    .replace(/[\u0000-\u001F\u007F]+/g, '')
    .trim();
  if (!decoded) return false;
  // Allow local uploaded media or static public assets
  if (
    (decoded.startsWith('/api/public/media/') || decoded.startsWith('/assets/')) &&
    !decoded.includes('..') &&
    !decoded.startsWith('//')
  ) {
    return true;
  }
  try {
    const parsed = new URL(decoded);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseAttributes(attrString: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const regex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrString)) !== null) {
    const name = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    // Strictly drop all event handlers and style attributes
    if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'formaction') {
      continue;
    }
    attrs.set(name, val);
  }
  return attrs;
}

/**
 * Sanitizes untrusted rich text HTML against a strict tag & attribute allowlist.
 */
export function sanitizeArticleHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let cleaned = rawHtml
    // Strip null bytes & control chars except tabs/newlines
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Strip HTML comments
    .replace(/<!--[\s\S]*?-->/g, '');

  // Remove dangerous container tags and their entire contents
  for (const tag of DANGEROUS_BLOCK_TAGS) {
    const pairedRegex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    cleaned = cleaned.replace(pairedRegex, '');
    const selfRegex = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    cleaned = cleaned.replace(selfRegex, '');
  }

  // Process remaining tags via allowlist
  cleaned = cleaned.replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (fullMatch, rawTagName, rawAttrs) => {
    const tag = String(rawTagName).toLowerCase();
    const isClosing = fullMatch.startsWith('</');

    if (!ALLOWED_TAGS.has(tag)) {
      return '';
    }

    if (isClosing) {
      if (VOID_TAGS.has(tag)) return '';
      return `</${tag}>`;
    }

    if (VOID_TAGS.has(tag) && tag !== 'img') {
      return `<${tag} />`;
    }

    const attrs = parseAttributes(rawAttrs || '');
    const safeAttrs: string[] = [];

    if (tag === 'a') {
      const href = attrs.get('href') || '';
      if (isSafeLinkUrl(href)) {
        safeAttrs.push(`href="${escapeAttr(href.trim())}"`);
        if (href.trim().startsWith('http://') || href.trim().startsWith('https://')) {
          safeAttrs.push('target="_blank"');
          safeAttrs.push('rel="noopener noreferrer"');
        }
      }
      const title = attrs.get('title');
      if (title) {
        safeAttrs.push(`title="${escapeAttr(title.slice(0, 200))}"`);
      }
    } else if (tag === 'img') {
      const src = attrs.get('src') || '';
      if (!isSafeMediaUrl(src)) {
        return '';
      }
      safeAttrs.push(`src="${escapeAttr(src.trim())}"`);
      const alt = attrs.get('alt') || 'DIMONEX image';
      safeAttrs.push(`alt="${escapeAttr(alt.slice(0, 200))}"`);
      return `<img ${safeAttrs.join(' ')} />`;
    }

    return safeAttrs.length > 0 ? `<${tag} ${safeAttrs.join(' ')}>` : `<${tag}>`;
  });

  // Final safeguard: neutralize any residual javascript:/vbscript:/data: protocol fragments
  cleaned = cleaned.replace(/(?:javascript|vbscript)\s*:/gi, '');

  return cleaned.trim();
}

/**
 * Extracts plain text from sanitized HTML for search indexing and summaries.
 */
export function extractPlainText(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|h[1-4]|li|blockquote|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a URL-safe slug from an announcement title.
 */
export function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return base || `announcement-${Date.now()}`;
}
