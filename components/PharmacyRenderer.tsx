import React, { useState } from 'react';

interface PharmacyHours {
  mon: string; tue: string; wed: string; thu: string;
  fri: string; sat: string; sun: string; holiday: string;
}

interface Pharmacy {
  name: string;
  address: string;
  phone: string;
  lat: number;
  lon: number;
  hours_today: string;
  is_open_now: boolean;
  hours?: PharmacyHours;
}

interface PharmacyData {
  query: string;
  pharmacies: Pharmacy[];
  summary?: string;
}

interface PharmacyRendererProps {
  data: PharmacyData;
}

const PAGE_SIZE = 5;

const DAY_LABELS = [
  { key: 'mon', label: '월' },
  { key: 'tue', label: '화' },
  { key: 'wed', label: '수' },
  { key: 'thu', label: '목' },
  { key: 'fri', label: '금' },
  { key: 'sat', label: '토', color: 'text-blue-400' },
  { key: 'sun', label: '일', color: 'text-red-400' },
  { key: 'holiday', label: '공휴', color: 'text-amber-400' },
] as const;

// Get current KST weekday key
const getTodayKey = (): string => {
  const d = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Seoul' }));
  return ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
};

/**
 * Computes real-time is_open_now from hours_today string (e.g. "09:00~18:00")
 * Falls back to the pre-computed value from the tool if hours_today is missing.
 */
const checkIsOpen = (hoursToday: string | undefined, fallback: boolean): boolean => {
  if (!hoursToday || hoursToday === '휴무') return false;
  const [startStr, endStr] = hoursToday.split('~');
  if (!startStr || !endStr) return fallback;
  const now = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Seoul' }));
  const cur = now.getHours() * 100 + now.getMinutes();
  const start = parseInt(startStr.replace(':', ''));
  const end   = parseInt(endStr.replace(':', ''));
  return cur >= start && cur <= end;
};

export const PharmacyRenderer: React.FC<PharmacyRendererProps> = ({ data }) => {
  const [page, setPage] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const todayKey = getTodayKey();

  if (!data?.pharmacies?.length) {
    return (
      <div className="my-4 p-6 rounded-3xl bg-white/5 border border-white/10 text-center text-slate-400">
        <i className="fa-solid fa-store-slash text-2xl mb-2 block" />
        <p className="text-sm">약국 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.pharmacies.length / PAGE_SIZE);
  const pageItems = data.pharmacies.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const openCount = data.pharmacies.filter(p => p.is_open_now).length;

  const kakaoMapUrl = (lat: number, lon: number, name: string) =>
    `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lon}`;

  const toggleExpand = (i: number) =>
    setExpandedIdx(prev => prev === i ? null : i);

  return (
    <div className="my-4 w-full">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <i className="fa-solid fa-prescription-bottle-medical text-white text-xs" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {data.query} 약국 검색
            </h3>
            <p className="text-[11px] text-slate-400">
              총 {data.pharmacies.length}개 중 영업중
              <span className="ml-1 font-bold text-emerald-500">{openCount}개</span>
            </p>
          </div>
        </div>
      </div>

      {data.summary && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 px-1">{data.summary}</p>
      )}

      {/* Cards — w-full forces consistent width regardless of content length */}
      <div className="flex flex-col gap-2 w-full">
        {pageItems.map((p, i) => {
          const isExpanded = expandedIdx === i;
          const hasHours = !!p.hours;
          // Always compute is_open from hours_today at render time (real-time accurate)
          const isOpen = checkIsOpen(p.hours_today, p.is_open_now);

          return (
            <div
              key={`${p.name}-${i}`}
              className="group relative w-full rounded-2xl border border-white/10 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl overflow-hidden transition-all duration-200 hover:border-emerald-400/30"
            >
              {/* Open/closed stripe */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${isOpen ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />

              {/* Main row — fixed height */}
              <div
                className={`pl-4 pr-3 sm:pl-5 sm:pr-4 h-[72px] sm:h-[84px] flex items-center ${hasHours ? 'cursor-pointer' : ''}`}
                onClick={() => hasHours && toggleExpand(i)}
              >
                <div className="flex items-center justify-between gap-2 w-full min-w-0">
                  {/* Left */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white truncate max-w-[140px] sm:max-w-[300px] lg:max-w-[520px] xl:max-w-[680px]">{p.name}</span>
                      <span className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full ${
                        isOpen
                          ? 'bg-emerald-500/10 border border-emerald-500/20'
                          : 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10'
                      }`}>
                        <span className={`w-1 h-1 rounded-full shrink-0 ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                        <span className={`text-[8px] font-bold leading-none ${isOpen ? 'text-emerald-500' : 'text-slate-400'}`}>
                          {isOpen ? '영업중' : '종료'}
                        </span>
                      </span>
                    </div>
                    <p className="text-[11px] sm:text-[12px] text-slate-500 dark:text-slate-400 truncate leading-snug w-full">
                      {p.address.replace(/^서울특별시 /, '')}
                    </p>
                    {p.hours_today && (
                      <div className="mt-0.5 flex items-center gap-1">
                        <i className="fa-regular fa-clock text-[9px] sm:text-[10px] text-slate-400" />
                        <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium tabular-nums">{p.hours_today}</span>
                      </div>
                    )}
                  </div>

                  {/* Right: buttons + expand chevron */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex flex-col gap-1">
                      {p.phone && (
                        <a
                          href={`tel:${p.phone}`}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-500 text-slate-500 dark:text-slate-400 transition-colors"
                          title={p.phone}
                        >
                          <i className="fa-solid fa-phone text-[10px]" />
                        </a>
                      )}
                      {p.lat && p.lon && (
                        <a
                          href={kakaoMapUrl(p.lat, p.lon, p.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-yellow-400/10 hover:text-yellow-500 text-slate-500 dark:text-slate-400 transition-colors"
                          title="카카오지도에서 보기"
                        >
                          <i className="fa-solid fa-location-dot text-[10px]" />
                        </a>
                      )}
                    </div>
                    {hasHours && (
                      <i className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-200 ml-1 ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                </div>
              </div>

              {/* Accordion: weekday grid */}
              {hasHours && isExpanded && (
                <div className="px-2 sm:px-5 pb-4 pt-1 border-t border-white/5 dark:border-white/[0.04]">
                  <p className="text-[9px] font-black text-slate-400/50 uppercase tracking-widest mb-2 px-2 sm:px-0">주간 · 공휴일 운영시간</p>
                  <div className="grid grid-cols-8 gap-0.5 sm:gap-1 text-center">
                    {DAY_LABELS.map(({ key, label, color }) => {
                      const val = p.hours![key as keyof PharmacyHours];
                      const isToday = key === todayKey;
                      const isOff = val === '휴무' || !val;
                      const [start, end] = val && val !== '휴무' ? val.split('~') : ['', ''];
                      return (
                        <div key={key} className="space-y-1">
                          <span className={`text-[8.5px] font-bold whitespace-nowrap tracking-tighter ${isToday ? 'text-emerald-400' : color || 'text-slate-500'}`}>
                            {label}{isToday ? ' ●' : ''}
                          </span>
                          <div className={`rounded-md sm:rounded-lg py-1 px-0 flex flex-col items-center justify-center min-h-[32px] ${
                            isToday
                              ? 'bg-emerald-500/15 border border-emerald-500/30'
                              : isOff
                                ? 'bg-red-500/5 border border-red-500/10'
                                : 'bg-white/[0.03] border border-white/[0.06]'
                          }`}>
                            {isOff ? (
                              <p className="text-[7.5px] sm:text-[8px] font-bold text-slate-600 tracking-tighter">휴무</p>
                            ) : (
                              <>
                                <p className={`text-[7.5px] sm:text-[8.5px] font-black tracking-tighter leading-none whitespace-nowrap ${isToday ? 'text-emerald-300' : 'text-slate-300'}`}>{start}</p>
                                <p className={`text-[7.5px] sm:text-[8px] tracking-tighter leading-none mt-0.5 whitespace-nowrap ${isToday ? 'text-emerald-400/60' : 'text-slate-600'}`}>~{end}</p>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-30 hover:enabled:bg-emerald-500/10 hover:enabled:text-emerald-500 hover:enabled:border-emerald-400/30 transition-all"
          >
            <i className="fa-solid fa-chevron-left text-[10px]" />
            이전
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-all ${
                  i === page
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                    : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-30 hover:enabled:bg-emerald-500/10 hover:enabled:text-emerald-500 hover:enabled:border-emerald-400/30 transition-all"
          >
            다음
            <i className="fa-solid fa-chevron-right text-[10px]" />
          </button>
        </div>
      )}
    </div>
  );
};

export default PharmacyRenderer;
