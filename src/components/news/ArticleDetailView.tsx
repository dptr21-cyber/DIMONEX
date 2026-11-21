/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ArticleDetailView.tsx
 * Public Announcement Detail Page with dynamic SEO/OpenGraph metadata and
 * XSS-safe React rendering via SafeArticleContent.
 */

import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Pin,
  Share2,
  Check,
  User,
  Newspaper,
  Clock,
} from 'lucide-react';
import { AnnouncementItem, ANNOUNCEMENT_CATEGORY_META } from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { SafeArticleContent } from './SafeArticleContent.js';
import { StatusBadge } from '../ui/StatusBadge.js';

interface ArticleDetailViewProps {
  slug: string;
  onBack: () => void;
  onOpenArticle: (slug: string) => void;
}

function upsertMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let tag = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export const ArticleDetailView: React.FC<ArticleDetailViewProps> = ({
  slug,
  onBack,
  onOpenArticle,
}) => {
  const [article, setArticle] = useState<AnnouncementItem | null>(null);
  const [related, setRelated] = useState<AnnouncementItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const loadArticle = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await safeFetchJson<AnnouncementItem>(
          `/api/public/news/${encodeURIComponent(slug)}`
        );
        if (!active) return;
        if (res.ok && res.data) {
          setArticle(res.data);

          // Update dynamic SEO & Social Sharing metadata
          const pageTitle = `${res.data.title} | DIMONEX Announcements`;
          document.title = pageTitle;
          upsertMetaTag('name', 'description', res.data.shortDescription);
          upsertMetaTag('property', 'og:title', pageTitle);
          upsertMetaTag('property', 'og:description', res.data.shortDescription);
          upsertMetaTag('property', 'og:type', 'article');
          if (res.data.coverImageUrl) {
            const absImg = res.data.coverImageUrl.startsWith('http')
              ? res.data.coverImageUrl
              : `${window.location.origin}${res.data.coverImageUrl}`;
            upsertMetaTag('property', 'og:image', absImg);
          }
          upsertMetaTag('name', 'twitter:card', 'summary_large_image');
          upsertMetaTag('name', 'twitter:title', pageTitle);
          upsertMetaTag('name', 'twitter:description', res.data.shortDescription);
        } else {
          setArticle(null);
          setError(res.error || 'Announcement not found or no longer public.');
        }

        // Load related published announcements
        const listRes = await safeFetchJson<{ items: AnnouncementItem[] }>(
          '/api/public/news?limit=4'
        );
        if (active && listRes.ok && listRes.data?.items) {
          setRelated(listRes.data.items.filter(i => i.slug !== slug).slice(0, 3));
        }
      } catch {
        if (active) setError('Failed to load announcement.');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadArticle();
    return () => {
      active = false;
    };
  }, [slug]);

  const handleCopyShareLink = async () => {
    try {
      const shareUrl = `${window.location.origin}/news/${encodeURIComponent(slug)}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-4">
        <div className="h-8 w-36 bg-[#141C24] rounded animate-pulse" />
        <div className="h-64 bg-[#141C24] border border-[#202B34] rounded-[10px] animate-pulse" />
        <div className="h-40 bg-[#141C24] border border-[#202B34] rounded-[10px] animate-pulse" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs text-[#8DA5B1] hover:text-[#E4EBEF] mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Overview
        </button>
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-3">
          <Newspaper className="w-10 h-10 text-[#53616A] mx-auto" />
          <h1 className="text-lg font-semibold text-[#E4EBEF]">Announcement Unavailable</h1>
          <p className="text-xs text-[#A1AFB8]">{error || 'This article does not exist or has been archived.'}</p>
        </div>
      </div>
    );
  }

  const catMeta = ANNOUNCEMENT_CATEGORY_META[article.category] || {
    label: article.category,
    tone: 'neutral' as const,
  };

  return (
    <div className="flex-1 p-4 lg:p-6 bg-[#090D12] overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Breadcrumb Bar */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[7px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] text-xs font-medium text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Homepage</span>
          </button>

          <button
            type="button"
            onClick={handleCopyShareLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-[#141C24] border border-[#202B34] hover:border-[#8DA5B1] text-xs font-medium text-[#E4EBEF] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16A879]" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-[#8DA5B1]" />
                <span>Share Article</span>
              </>
            )}
          </button>
        </div>

        {/* Main Article Container */}
        <article className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          {article.coverImageUrl && (
            <div className="w-full max-h-[360px] bg-[#0B1016] border-b border-[#202B34] overflow-hidden">
              <img
                src={article.coverImageUrl}
                alt={article.title}
                className="w-full h-full max-h-[360px] object-cover"
              />
            </div>
          )}

          <div className="p-6 lg:p-8 space-y-5">
            {/* Badges & Meta */}
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusBadge tone={catMeta.tone}>{catMeta.label}</StatusBadge>
              {article.isPinned && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-[#17212B] border border-[#2B3944] text-[10px] font-mono text-[#E4EBEF]">
                  <Pin className="w-3 h-3 text-[#8DA5B1]" />
                  PINNED
                </span>
              )}
              {article.version && article.version > 1 && (
                <span className="text-[10px] font-mono text-[#71818B]">
                  Rev v{article.version}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-[#E4EBEF] tracking-tight leading-snug">
              {article.title}
            </h1>

            <p className="text-sm text-[#A1AFB8] leading-relaxed border-l-2 border-[#2B3944] pl-3.5">
              {article.shortDescription}
            </p>

            {/* Author & Dates */}
            <div className="flex flex-wrap items-center gap-4 pt-2 pb-4 border-b border-[#202B34] text-xs text-[#71818B] font-mono">
              <span className="inline-flex items-center gap-1.5 text-[#C1D0D6]">
                <User className="w-3.5 h-3.5 text-[#8DA5B1]" />
                {article.authorName || 'DIMONEX Official'}
              </span>
              {article.publishedAt && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#8DA5B1]" />
                  Published {new Date(article.publishedAt).toLocaleString()}
                </span>
              )}
              {article.updatedAt && article.updatedAt !== article.publishedAt && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#71818B]" />
                  Updated {new Date(article.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Sanitized Full Article Body */}
            <SafeArticleContent html={article.contentHtml || ''} />
          </div>
        </article>

        {/* Related Announcements */}
        {related.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[#E4EBEF]">More Official Announcements</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {related.map(rel => {
                const rCat = ANNOUNCEMENT_CATEGORY_META[rel.category];
                return (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => onOpenArticle(rel.slug)}
                    className="text-left p-4 rounded-[9px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] space-y-2 transition-colors cursor-pointer"
                  >
                    <StatusBadge tone={rCat?.tone || 'neutral'}>
                      {rCat?.label || rel.category}
                    </StatusBadge>
                    <h3 className="text-xs font-semibold text-[#E4EBEF] line-clamp-2">
                      {rel.title}
                    </h3>
                    <p className="text-[11px] text-[#71818B] line-clamp-2">
                      {rel.shortDescription}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
