/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NewsCarousel.tsx
 * Responsive Latest News & Announcements Carousel for the DIMONEX public homepage.
 * Loads strictly from real backend API (`GET /api/public/news`) — never uses mock/hardcoded items.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Newspaper,
  Pin,
  ChevronLeft,
  ChevronRight,
  Calendar,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react';
import {
  AnnouncementCategory,
  AnnouncementItem,
  ANNOUNCEMENT_CATEGORY_META,
} from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { StatusBadge } from '../ui/StatusBadge.js';

interface NewsCarouselProps {
  onOpenArticle: (slug: string) => void;
}

const FILTER_CATEGORIES: { id: 'ALL' | AnnouncementCategory; label: string }[] = [
  { id: 'ALL', label: 'All Updates' },
  { id: 'ANNOUNCEMENT', label: 'Announcement' },
  { id: 'NEW_LISTING', label: 'New Listing' },
  { id: 'PLATFORM_UPDATE', label: 'Platform' },
  { id: 'SECURITY_ALERT', label: 'Security' },
  { id: 'MAINTENANCE', label: 'Maintenance' },
  { id: 'TRADING_COMPETITION', label: 'Competition' },
];

function formatDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const NewsCarousel: React.FC<NewsCarouselProps> = ({ onOpenArticle }) => {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [category, setCategory] = useState<'ALL' | AnnouncementCategory>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchPublicNews = useCallback(async (selectedCategory: string, selectedPage: number) => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(selectedPage),
        limit: '6',
      });
      if (selectedCategory !== 'ALL') {
        qs.set('category', selectedCategory);
      }
      const res = await safeFetchJson<{
        items: AnnouncementItem[];
        pagination: { page: number; totalPages: number; total: number };
      }>(`/api/public/news?${qs.toString()}`);

      if (res.ok && res.data && Array.isArray(res.data.items)) {
        setItems(res.data.items);
        setTotalPages(res.data.pagination?.totalPages || 1);
        setTotal(res.data.pagination?.total || res.data.items.length);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPublicNews(category, page);
  }, [category, page, fetchPublicNews]);

  const scrollCarousel = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(300, Math.floor(el.clientWidth * 0.78));
    el.scrollBy({ left: dir === 'left' ? -step : step, behavior: 'smooth' });
  };

  return (
    <section
      aria-label="Latest News & Announcements"
      className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 lg:p-6 space-y-4"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
            <Newspaper className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[#E4EBEF]">
                Latest News &amp; Announcements
              </h2>
              {total > 0 && (
                <span className="px-1.5 py-0.5 rounded-[4px] bg-[#111820] border border-[#202B34] text-[10px] font-mono text-[#8DA5B1]">
                  {total} Published
                </span>
              )}
            </div>
            <p className="text-xs text-[#71818B]">
              Official DIMONEX exchange updates, new listings, maintenance schedules, and security advisories.
            </p>
          </div>
        </div>

        {/* Carousel Navigation Arrows */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchPublicNews(category, page)}
            className="w-8 h-8 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer"
            title="Refresh announcements"
            aria-label="Refresh announcements"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => scrollCarousel('left')}
            disabled={items.length === 0}
            className="w-8 h-8 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-40 text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Scroll announcements left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollCarousel('right')}
            disabled={items.length === 0}
            className="w-8 h-8 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-40 text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Scroll announcements right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Category Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {FILTER_CATEGORIES.map(tab => {
          const active = category === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setCategory(tab.id);
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-[6px] text-xs whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                  : 'bg-[#111820] text-[#71818B] hover:text-[#E4EBEF] border border-[#202B34]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Cards Carousel / Loading / Empty State */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(n => (
            <div
              key={n}
              className="rounded-[9px] bg-[#111820] border border-[#202B34] overflow-hidden animate-pulse"
            >
              <div className="h-36 bg-[#17212B]" />
              <div className="p-4 space-y-2.5">
                <div className="h-3 w-24 bg-[#1D2832] rounded" />
                <div className="h-4 w-3/4 bg-[#1D2832] rounded" />
                <div className="h-3 w-full bg-[#17212B] rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[9px] bg-[#111820] border border-[#202B34] py-10 px-4 text-center space-y-1.5">
          <Newspaper className="w-7 h-7 text-[#53616A] mx-auto" />
          <p className="text-sm font-medium text-[#A1AFB8]">
            No published announcements yet
          </p>
          <p className="text-xs text-[#71818B] max-w-md mx-auto">
            Official exchange updates published from the DIMONEX Admin Console will appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-thin"
          >
            {items.map(article => {
              const catMeta = ANNOUNCEMENT_CATEGORY_META[article.category] || {
                label: article.category,
                tone: 'neutral' as const,
              };

              return (
                <article
                  key={article.id}
                  onClick={() => onOpenArticle(article.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenArticle(article.slug);
                    }
                  }}
                  className="snap-start shrink-0 w-[85vw] sm:w-[330px] lg:w-[calc((100%-32px)/3)] rounded-[9px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] overflow-hidden flex flex-col justify-between group cursor-pointer transition-colors"
                >
                  <div>
                    {/* Cover Image */}
                    <div className="relative h-40 w-full bg-[#0B1016] border-b border-[#202B34] overflow-hidden">
                      {article.coverImageUrl ? (
                        <img
                          src={article.coverImageUrl}
                          alt={article.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#141C24] via-[#111820] to-[#090D12] px-4 text-center">
                          <Newspaper className="w-7 h-7 text-[#40515D] mb-1.5" />
                          <span className="text-[10px] font-mono uppercase tracking-widest text-[#71818B]">
                            DIMONEX Official Notice
                          </span>
                        </div>
                      )}

                      {article.isPinned && (
                        <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-[#090D12]/90 border border-[#8DA5B1]/50 text-[10px] font-mono font-semibold text-[#E4EBEF]">
                          <Pin className="w-3 h-3 text-[#8DA5B1]" />
                          <span>PINNED</span>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge tone={catMeta.tone}>{catMeta.label}</StatusBadge>
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#71818B]">
                          <Calendar className="w-3 h-3" />
                          {formatDate(article.publishedAt)}
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-[#E4EBEF] group-hover:text-white line-clamp-2 leading-snug">
                        {article.title}
                      </h3>

                      <p className="text-xs text-[#A1AFB8] line-clamp-3 leading-relaxed">
                        {article.shortDescription}
                      </p>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-4 py-2.5 border-t border-[#202B34]/80 flex items-center justify-between text-[11px]">
                    <span className="text-[#71818B] truncate max-w-[65%]">
                      {article.authorName || 'DIMONEX Official'}
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium text-[#8DA5B1] group-hover:text-[#E4EBEF] transition-colors">
                      Read Article
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Pagination Bar */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-[#202B34] text-xs">
              <span className="text-[#71818B] font-mono">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-[6px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-40 text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-[6px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-40 text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
