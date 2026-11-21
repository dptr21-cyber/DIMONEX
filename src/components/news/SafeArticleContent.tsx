/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SafeArticleContent.tsx
 * Renders sanitized announcement HTML into a strict allowlisted React element tree
 * using DOMParser — NEVER uses dangerouslySetInnerHTML, eliminating client-side XSS.
 */

import React, { useMemo } from 'react';

interface SafeArticleContentProps {
  html: string;
  className?: string;
}

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4',
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
]);

function isSafeHref(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {}
  return null;
}

function isSafeImgSrc(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('/api/public/media/') || trimmed.startsWith('/assets/')) &&
    !trimmed.includes('..') &&
    !trimmed.startsWith('//')
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {}
  return null;
}

function renderDomNode(node: ChildNode, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Drop dangerous tags completely
    if (['script', 'style', 'iframe', 'svg', 'object', 'embed', 'form', 'noscript'].includes(tag)) {
      return null;
    }
    // Unwrap unknown benign tags safely as plain children
    return Array.from(el.childNodes).map((child, idx) => renderDomNode(child, `${key}-${idx}`));
  }

  const children = Array.from(el.childNodes).map((child, idx) =>
    renderDomNode(child, `${key}-${idx}`)
  );

  switch (tag) {
    case 'h1':
      return <h1 key={key} className="text-2xl font-bold text-[#E4EBEF] mt-6 mb-3 tracking-tight">{children}</h1>;
    case 'h2':
      return <h2 key={key} className="text-xl font-bold text-[#E4EBEF] mt-5 mb-2.5 tracking-tight">{children}</h2>;
    case 'h3':
      return <h3 key={key} className="text-lg font-semibold text-[#E4EBEF] mt-4 mb-2">{children}</h3>;
    case 'h4':
      return <h4 key={key} className="text-base font-semibold text-[#C1D0D6] mt-3 mb-1.5">{children}</h4>;
    case 'p':
      return <p key={key} className="text-sm text-[#C1D0D6] leading-relaxed mb-3.5">{children}</p>;
    case 'br':
      return <br key={key} />;
    case 'hr':
      return <hr key={key} className="border-[#202B34] my-5" />;
    case 'strong':
    case 'b':
      return <strong key={key} className="font-semibold text-[#E4EBEF]">{children}</strong>;
    case 'em':
    case 'i':
      return <em key={key} className="italic text-[#C1D0D6]">{children}</em>;
    case 'u':
      return <u key={key} className="underline decoration-[#8DA5B1]/60 underline-offset-2">{children}</u>;
    case 's':
      return <s key={key} className="line-through text-[#71818B]">{children}</s>;
    case 'ul':
      return <ul key={key} className="list-disc pl-5 space-y-1.5 mb-4 text-sm text-[#C1D0D6]">{children}</ul>;
    case 'ol':
      return <ol key={key} className="list-decimal pl-5 space-y-1.5 mb-4 text-sm text-[#C1D0D6]">{children}</ol>;
    case 'li':
      return <li key={key} className="leading-relaxed">{children}</li>;
    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-[#8DA5B1] bg-[#111820] pl-4 pr-3 py-2.5 my-4 rounded-r-[7px] text-sm text-[#A1AFB8] italic"
        >
          {children}
        </blockquote>
      );
    case 'code':
      return (
        <code
          key={key}
          className="px-1.5 py-0.5 rounded-[4px] bg-[#111820] border border-[#202B34] font-mono text-xs text-[#A5BAC4]"
        >
          {children}
        </code>
      );
    case 'pre':
      return (
        <pre
          key={key}
          className="p-3.5 rounded-[8px] bg-[#0B1016] border border-[#202B34] font-mono text-xs text-[#C1D0D6] overflow-x-auto my-4"
        >
          {children}
        </pre>
      );
    case 'a': {
      const safeHref = isSafeHref(el.getAttribute('href'));
      if (!safeHref) return <span key={key}>{children}</span>;
      const isExternal = safeHref.startsWith('http://') || safeHref.startsWith('https://');
      return (
        <a
          key={key}
          href={safeHref}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className="text-[#8DA5B1] hover:text-[#E4EBEF] underline decoration-[#8DA5B1]/50 underline-offset-2 transition-colors"
        >
          {children}
        </a>
      );
    }
    case 'img': {
      const safeSrc = isSafeImgSrc(el.getAttribute('src'));
      if (!safeSrc) return null;
      return (
        <img
          key={key}
          src={safeSrc}
          alt={el.getAttribute('alt') || 'DIMONEX announcement image'}
          loading="lazy"
          className="max-w-full rounded-[8px] border border-[#202B34] my-4 object-cover"
        />
      );
    }
    case 'table':
      return (
        <div key={key} className="overflow-x-auto my-4 rounded-[8px] border border-[#202B34]">
          <table className="w-full text-left text-xs text-[#C1D0D6] border-collapse">{children}</table>
        </div>
      );
    case 'thead':
      return <thead key={key} className="bg-[#111820] text-[#A1AFB8] border-b border-[#202B34]">{children}</thead>;
    case 'tbody':
      return <tbody key={key} className="divide-y divide-[#202B34]">{children}</tbody>;
    case 'tr':
      return <tr key={key}>{children}</tr>;
    case 'th':
      return <th key={key} className="px-3 py-2 font-semibold">{children}</th>;
    case 'td':
      return <td key={key} className="px-3 py-2">{children}</td>;
    case 'div':
      return <div key={key} className="mb-2">{children}</div>;
    case 'span':
    default:
      return <span key={key}>{children}</span>;
  }
}

export const SafeArticleContent: React.FC<SafeArticleContentProps> = ({ html, className = '' }) => {
  const renderedNodes = useMemo(() => {
    if (!html || typeof window === 'undefined') return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      return Array.from(doc.body.childNodes).map((node, i) => renderDomNode(node, `n-${i}`));
    } catch {
      return <p className="text-sm text-[#C1D0D6] whitespace-pre-wrap">{html.replace(/<[^>]+>/g, '')}</p>;
    }
  }, [html]);

  return <div className={`dimonex-article-body ${className}`}>{renderedNodes}</div>;
};
