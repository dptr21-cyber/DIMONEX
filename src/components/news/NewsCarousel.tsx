/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NewsCarousel.tsx
 * Responsive Latest News & Announcements Carousel for DIMONEX public homepages
 * (Desktop/Tablet OverviewView & Mobile MobileHomeView).
 *
 * Loads strictly from real backend API (`GET /api/public/news`) — never uses mock items.
 * Enforces published-only filtering and pinned-first ordering on both server and client.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Newspaper,
  Pin,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import {
  AnnouncementCategory,
  AnnouncementItem,
  ANNOUNCEMENT_CATEGORY_META,
} from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';

interface NewsCarouselProps {
  onOpenArticle: (slug: string) => void;
  compact?: boolean;
}

type CarouselFilterId = 'ALL' | 'PINNED' | AnnouncementCategory;

const CATEGORY_TABS: { id: CarouselFilterId; label: string }[] = [
  { id: 'ALL', label: 'All Updates' },
  { id: 'ANNOUNCEMENT', label: 'Announcement' },
  { id: 'NEW_LISTING', label: 'New Listing' },
  { id: 'PLATFORM_UPDATE', label: 'Platform' },
  { id: 'SECURITY_ALERT', label: 'Security' },
  { id: 'MAINTENANCE', label: 'Maintenance' },
  { id: 'TRADING_COMPETITION', label: 'Competition' },
  { id: 'DEPOSIT_WITHDRAWAL_UPDATE', label: 'Deposit & Withdrawal' },
  { id: 'IMPORTANT_NOTICE', label: 'Important Notice' },
];

const CATEGORY_TEXT_TONE: Record<string, string> = {
  danger: 'text-[#F0757E]',
  warning: 'text-[#E1B86E]',
  buy: 'text-[#35B887]',
  info: 'text-[#7EB0F2]',
  brand: 'text-[#A5BAC4]',
  neutral: 'text-[#8DA5B1]',
};

function formatDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const NewsCarousel: React.FC<NewsCarouselProps> = ({
  onOpenArticle,
  compact = false,
}) => {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [filter, setFilter] = useState<CarouselFilterId>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchPublicNews = useCallback(
    async (selectedFilter: CarouselFilterId, selectedPage: number) => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const qs = new URLSearchParams({
          page: String(selectedPage),
          limit: compact ? '6' : '9',
        });
        if (selectedFilter === 'PINNED') {
          qs.set('pinnedOnly', 'true');
        } else if (selectedFilter !== 'ALL') {
          qs.set('category', selectedFilter);
        }

        const res = await safeFetchJson<{
          items: AnnouncementItem[];
          pinnedCount?: number;
          pagination: { page: number; totalPages: number; total: number };
        }>(`/api/public/news?${qs.toString()}`);

        if (res.ok && res.data && Array.isArray(res.data.items)) {
          // Defensive published-only guard + deterministic pinned-first sorting
          const publishedOnly = res.data.items
            .filter(
              item =>
                (!item.status || item.status === 'PUBLISHED') &&
                Boolean(item.publishedAt) &&
                Boolean(item.slug)
            )
            .sort((a, b) => {
              if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
                return a.isPinned ? -1 : 1;
              }
              return (b.publishedAt || 0) - (a.publishedAt || 0);
            });

          setItems(publishedOnly);
          setTotalPages(res.data.pagination?.totalPages || 1);
          setTotal(res.data.pagination?.total ?? publishedOnly.length);
          setPinnedCount(
            typeof res.data.pinnedCount === 'number'
              ? res.data.pinnedCount
              : publishedOnly.filter(i => i.isPinned).length
          );
        } else {
          setItems([]);
          setTotal(0);
          setTotalPages(1);
          if (!res.ok) {
            setFetchError(res.error || 'Unable to load announcements.');
          }
        }
      } catch {
        setItems([]);
        setFetchError('Network error while loading announcements.');
      } finally {
        setIsLoading(false);
      }
    },
    [compact]
  );

  useEffect(() => {
    fetchPublicNews(filter, page);
  }, [filter, page, fetchPublicNews]);

  // Real-time refresh when an admin publishes an announcement via WebSocket event
  useEffect(() => {
    const handleLiveUpdate = () => {
      fetchPublicNews(filter, page);
    };
    window.addEventListener('dimonex:news-updated', handleLiveUpdate);
    return () => {
      window.removeEventListener('dimonex:news-updated', handleLiveUpdate);
    };
  }, [filter, page, fetchPublicNews]);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(maxScroll - el.scrollLeft > 8);

    const firstCard = el.firstElementChild as HTMLElement | null;
    if (firstCard && firstCard.offsetWidth > 0) {
      const cardStride = firstCard.offsetWidth + 16;
      const idx = Math.round(el.scrollLeft / cardStride);
      setActiveSlideIndex(Math.max(0, Math.min(items.length - 1, idx)));
    }
  }, [items.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: 'auto' });
    setActiveSlideIndex(0);
    const frame = requestAnimationFrame(updateScrollState);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateScrollState())
        : null;
    resizeObserver?.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [items, updateScrollState]);

  const scrollCarousel = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(280, Math.floor(el.clientWidth * 0.85));
    el.scrollBy({ left: dir === 'left' ? -step : step, behavior: 'smooth' });
  };

  const scrollToSlide = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.children[index] as HTMLElement | undefined;
    if (target) {
      el.scrollTo({ left: target.offsetLeft, behavior: 'smooth' });
    }
  };

  const topPinnedArticle = useMemo(
    () => items.find(a => a.isPinned) || null,
    [items]
  );

  const visibleTabs = useMemo(() => {
    if (pinnedCount > 0) {
      return [
        CATEGORY_TABS[0],
        { id: 'PINNED' as CarouselFilterId, label: `Pinned (${pinnedCount})` },
        ...CATEGORY_TABS.slice(1),
      ];
    }
    return CATEGORY_TABS;
  }, [pinnedCount]);

  return (
    <section
      aria-label="Latest News & Announcements"
      className={`rounded-[10px] bg-[#141C24] border border-[#202B34] ${
        compact ? 'p-4 space-y-3' : 'p-5 lg:p-6 space-y-4'
      }`}
    >
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2
              className={`${
                compact ? 'text-sm' : 'text-base sm:text-lg'
              } font-semibold text-[#E4EBEF] tracking-tight`}
            >
              Latest News &amp; Announcements
            </h2>
            {total > 0 && (
              <span className="text-xs font-mono tabular-nums text-[#71818B]">
                · {total} published{pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ''}
              </span>
            )}
          </div>
          {!compact && (
            <p className="text-xs text-[#71818B] mt-0.5">
              Official exchange notices, market listings, platform releases, and security updates.
            </p>
          )}
        </div>

        {/* Carousel Navigation Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => fetchPublicNews(filter, page)}
            className="min-h-[36px] min-w-[36px] sm:w-9 sm:h-9 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DA5B1]"
            title="Refresh announcements"
            aria-label="Refresh announcements"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => scrollCarousel('left')}
            disabled={!canScrollLeft || items.length === 0}
            className="min-h-[36px] min-w-[36px] sm:w-9 sm:h-9 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-35 disabled:cursor-not-allowed text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DA5B1]"
            aria-label="Previous announcements"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollCarousel('right')}
            disabled={!canScrollRight || items.length === 0}
            className="min-h-[36px] min-w-[36px] sm:w-9 sm:h-9 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-35 disabled:cursor-not-allowed text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DA5B1]"
            aria-label="Next announcements"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Pinned Announcement Spotlight Bar (only when a published pinned notice is active) */}
      {!isLoading && topPinnedArticle && filter === 'ALL' && page === 1 && (
        <button
          type="button"
          onClick={() => onOpenArticle(topPinnedArticle.slug)}
          className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[8px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1]/70 text-left transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DA5B1]"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Pin className="w-3.5 h-3.5 text-[#8DA5B1] shrink-0" />
            <span className="text-xs font-medium text-[#8DA5B1] whitespace-nowrap shrink-0">
              Pinned
            </span>
            <span aria-hidden="true" className="text-[#40515D] shrink-0">
              ·
            </span>
            <span className="text-xs font-medium text-[#E4EBEF] group-hover:text-white truncate">
              {topPinnedArticle.title}
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[#8DA5B1] group-hover:text-[#E4EBEF] whitespace-nowrap shrink-0">
            {formatDate(topPinnedArticle.publishedAt)}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </button>
      )}

      {/* Interactive Category Filter Controls */}
      <div
        role="tablist"
        aria-label="Filter announcements by category"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin"
      >
        {visibleTabs.map(tab => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setFilter(tab.id);
                setPage(1);
              }}
              className={`min-h-[34px] px-3 py-1.5 rounded-[6px] text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DA5B1] ${
                active
                  ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#40515D]'
                  : 'bg-[#111820] text-[#8E9EA8] hover:text-[#E4EBEF] border border-[#202B34]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Carousel Track / Loading / Error / Empty State */}
      {isLoading ? (
        <div
          className={`grid gap-4 ${
            compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {(compact ? [1] : [1, 2, 3]).map(n => (
            <div
              key={n}
              className="rounded-[9px] bg-[#111820] border border-[#202B34] overflow-hidden animate-pulse"
            >
              <div className="h-36 bg-[#17212B]" />
              <div className="p-4 space-y-2.5">
                <div className="h-3 w-32 bg-[#1D2832] rounded" />
                <div className="h-4 w-4/5 bg-[#1D2832] rounded" />
                <div className="h-3 w-full bg-[#17212B] rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-[9px] bg-[#111820] border border-[#202B34] py-8 px-4 text-center space-y-2.5">
          <AlertCircle className="w-6 h-6 text-[#EA5B65] mx-auto" />
          <p className="text-sm font-medium text-[#E4EBEF]">{fetchError}</p>
          <button
            type="button"
            onClick={() => fetchPublicNews(filter, page)}
            className="px-3.5 py-1.5 rounded-[6px] bg-[#1D2832] border border-[#2B3944] hover:border-[#8DA5B1] text-xs font-medium text-[#E4EBEF] cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[9px] bg-[#111820] border border-[#202B34] py-9 px-4 text-center space-y-1.5">
          <Newspaper className="w-6 h-6 text-[#53616A] mx-auto" />
          <p className="text-sm font-medium text-[#A1AFB8]">
            {filter === 'ALL'
              ? 'No published announcements yet'
              : 'No published announcements in this category'}
          </p>
          <p className="text-xs text-[#71818B] max-w-md mx-auto">
            {filter === 'ALL'
              ? 'Official exchange updates published from the DIMONEX Admin Console appear here automatically.'
              : 'Try selecting All Updates to view all published DIMONEX announcements.'}
          </p>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={updateScrollState}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                scrollCarousel('right');
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                scrollCarousel('left');
              }
            }}
            className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-thin scroll-smooth"
          >
            {items.map(article => {
              const catMeta = ANNOUNCEMENT_CATEGORY_META[article.category] || {
                label: article.category,
                tone: 'neutral' as const,
              };
              const catTextClass =
                CATEGORY_TEXT_TONE[catMeta.tone] || CATEGORY_TEXT_TONE.neutral;
              const showCoverImage =
                Boolean(article.coverImageUrl) && !failedImages[article.id];

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
                  className={`snap-start shrink-0 ${
                    compact
                      ? 'w-[84vw] sm:w-[300px]'
                      : 'w-[86vw] sm:w-[340px] md:w-[calc((100%-16px)/2)] lg:w-[calc((100%-32px)/3)]'
                  } rounded-[9px] bg-[#111820] border ${
                    article.isPinned
                      ? 'border-[#8DA5B1]/50 hover:border-[#A5BAC4]'
                      : 'border-[#202B34] hover:border-[#40515D]'
                  } overflow-hidden flex flex-col justify-between group cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DA5B1]`}
                >
                  <div>
                    {/* Cover Image with Zero-Broken-Image Fallback */}
                    <div
                      className={`relative ${
                        compact ? 'h-32' : 'h-40'
                      } w-full bg-[#0B1016] border-b border-[#202B34] overflow-hidden`}
                    >
                      {showCoverImage ? (
                        <img
                          src={article.coverImageUrl}
                          alt={article.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedImages(prev => ({ ...prev, [article.id]: true }))
                          }
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#17212B] via-[#111820] to-[#090D12] px-5 text-center">
                          <Newspaper className="w-6 h-6 text-[#40515D] mb-1.5" />
                          <span className="text-xs font-medium text-[#71818B] line-clamp-1">
                            {catMeta.label}
                          </span>
                        </div>
                      )}
                      {showCoverImage && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#090D12]/70 via-[#090D12]/25 to-transparent" />
                      )}
                    </div>

                    {/* Article Body — Clean Unboxed Editorial Metadata */}
                    <div className="p-4 space-y-2">
                      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-xs">
                        {article.isPinned && (
                          <>
                            <span className="inline-flex items-center gap-1 font-semibold text-[#E4EBEF]">
                              <Pin className="w-3 h-3 text-[#8DA5B1]" />
                              Pinned
                            </span>
                            <span aria-hidden="true" className="text-[#40515D]">
                              ·
                            </span>
                          </>
                        )}
                        <span className={`font-medium ${catTextClass}`}>
                          {catMeta.label}
                        </span>
                        <span aria-hidden="true" className="text-[#40515D]">
                          ·
                        </span>
                        <time
                          dateTime={
                            article.publishedAt
                              ? new Date(article.publishedAt).toISOString()
                              : undefined
                          }
                          className="font-mono tabular-nums text-[#71818B]"
                        >
                          {formatDate(article.publishedAt)}
                        </time>
                      </div>

                      <h3 className="text-[15px] font-semibold text-[#E4EBEF] group-hover:text-white line-clamp-2 leading-snug">
                        {article.title}
                      </h3>

                      <p className="text-xs text-[#A1AFB8] line-clamp-2 leading-relaxed">
                        {article.shortDescription}
                      </p>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-4 py-2.5 border-t border-[#202B34]/80 flex items-center justify-between text-xs">
                    <span className="text-[#71818B] truncate max-w-[60%]">
                      {article.authorName || 'DIMONEX Official'}
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium text-[#8DA5B1] group-hover:text-[#E4EBEF] transition-colors whitespace-nowrap shrink-0">
                      Read Article
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Slide Position Dots + Server Pagination Bar */}
          {(items.length > 1 || totalPages > 1) && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#202B34] text-xs">
              {/* Carousel Scroll Indicators */}
              <div className="flex items-center gap-1.5" aria-label="Carousel position">
                {items.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSlide(idx)}
                    aria-label={`View announcement ${idx + 1}: ${item.title}`}
                    className={`h-1.5 rounded-full transition-all cursor-pointer ${
                      idx === activeSlideIndex
                        ? 'w-5 bg-[#8DA5B1]'
                        : 'w-1.5 bg-[#2B3944] hover:bg-[#53616A]'
                    }`}
                  />
                ))}
              </div>

              {/* Multi-Page Controls */}
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[#71818B] font-mono tabular-nums">
                    Page {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-[6px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-40 text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded-[6px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] disabled:opacity-40 text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};
