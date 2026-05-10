import React, { useState } from 'react';

interface Hospital {
  name: string;
  address: string;
  phone: string;
  url: string;
  type: string;
  doctor_count: number;
  established: string;
  lat: number;
  lon: number;
}

interface HospitalData {
  query: string;
  count: number;
  hospitals: Hospital[];
}

interface HospitalRendererProps {
  data: HospitalData;
}

const PAGE_SIZE = 5;

const TYPE_STYLE: Record<string, { bg: string; text: string }> = {
  '상급종합': { bg: 'bg-violet-500/10 border border-violet-500/20', text: 'text-violet-400' },
  '상급종합병원': { bg: 'bg-violet-500/10 border border-violet-500/20', text: 'text-violet-400' },
  '종합병원': { bg: 'bg-blue-500/10 border border-blue-500/20', text: 'text-blue-400' },
  '병원': { bg: 'bg-sky-500/10 border border-sky-500/20', text: 'text-sky-400' },
  '의원': { bg: 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10', text: 'text-slate-400' },
};

const getTypeStyle = (type: string) =>
  TYPE_STYLE[type] ?? { bg: 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10', text: 'text-slate-400' };

const kakaoMapUrl = (lat: number, lon: number, name: string) =>
  `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lon}`;

export const HospitalRenderer: React.FC<HospitalRendererProps> = ({ data }) => {
  const [page, setPage] = useState(0);

  const handlePhoneClick = (e: React.MouseEvent<HTMLAnchorElement>, phone: string) => {
    e.stopPropagation();
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) {
      e.preventDefault();
      navigator.clipboard.writeText(phone).catch(() => {});
      window.dispatchEvent(new CustomEvent('custom-toast', {
        detail: { message: `📞 전화번호: ${phone}`, type: 'success' }
      }));
    }
  };

  if (!data?.hospitals?.length) {
    return (
      <div className="my-4 p-6 rounded-3xl bg-white/5 border border-white/10 text-center text-slate-400">
        <i className="fa-solid fa-hospital-slash text-2xl mb-2 block" />
        <p className="text-sm">병원 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.hospitals.length / PAGE_SIZE);
  const pageItems = data.hospitals.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="my-4 w-full">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <i className="fa-solid fa-hospital text-white text-xs" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {data.query} 병원 검색
          </h3>
          <p className="text-[11px] text-slate-400">
            상위 <span className="font-bold text-blue-400">{data.hospitals.length}개</span> 결과 (의사수 기준)
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 w-full">
        {pageItems.map((h, i) => {
          const typeStyle = getTypeStyle(h.type);
          const hasCoords = h.lat !== 0 && h.lon !== 0;

          return (
            <div
              key={`${h.name}-${i}`}
              className="relative w-full rounded-2xl border border-white/10 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl overflow-hidden"
            >
              {/* Left accent stripe by type */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${
                h.type.includes('상급종합') ? 'bg-violet-500' :
                h.type.includes('종합병원') ? 'bg-blue-500' :
                h.type.includes('병원') ? 'bg-sky-400' : 'bg-slate-400'
              }`} />

              <div className="pl-4 pr-3 sm:pl-5 sm:pr-4 py-3 sm:py-4">
                <div className="flex items-start justify-between gap-2 w-full min-w-0">
                  {/* Left: info */}
                  <div className="min-w-0 flex-1">
                    {/* Name + type badge */}
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white truncate max-w-[160px] sm:max-w-[320px] lg:max-w-[540px]">
                        {h.name}
                      </span>
                      <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold ${typeStyle.bg} ${typeStyle.text}`}>
                        {h.type}
                      </span>
                    </div>

                    {/* Address */}
                    <p className="text-[11px] sm:text-[12px] text-slate-500 dark:text-slate-400 truncate leading-snug">
                      {h.address.replace(/^서울특별시 /, '').replace(/^부산광역시 /, '').replace(/^대구광역시 /, '').replace(/^인천광역시 /, '')}
                    </p>

                    {/* Doctor count + established */}
                    <div className="mt-1 flex items-center gap-3">
                      {h.doctor_count > 0 && (
                        <div className="flex items-center gap-1">
                          <i className="fa-solid fa-user-doctor text-[9px] sm:text-[10px] text-blue-400" />
                          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium tabular-nums">
                            의사 {h.doctor_count.toLocaleString()}명
                          </span>
                        </div>
                      )}
                      {h.established && (
                        <div className="flex items-center gap-1">
                          <i className="fa-regular fa-calendar text-[9px] sm:text-[10px] text-slate-400" />
                          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {h.established} 개설
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: action buttons */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {h.phone && (
                      <a
                        href={`tel:${h.phone}`}
                        onClick={e => handlePhoneClick(e, h.phone)}
                        className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-blue-500/10 hover:text-blue-500 text-slate-500 dark:text-slate-400 transition-colors"
                        title={h.phone}
                      >
                        <i className="fa-solid fa-phone text-[10px]" />
                      </a>
                    )}
                    {hasCoords && (
                      <a
                        href={kakaoMapUrl(h.lat, h.lon, h.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-yellow-400/10 hover:text-yellow-500 text-slate-500 dark:text-slate-400 transition-colors"
                        title="카카오지도에서 보기"
                      >
                        <i className="fa-solid fa-location-dot text-[10px]" />
                      </a>
                    )}
                    {h.url && (
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 transition-colors"
                        title="병원 홈페이지"
                      >
                        <i className="fa-solid fa-globe text-[10px]" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-30 hover:enabled:bg-blue-500/10 hover:enabled:text-blue-500 hover:enabled:border-blue-400/30 transition-all"
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
                    ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-30 hover:enabled:bg-blue-500/10 hover:enabled:text-blue-500 hover:enabled:border-blue-400/30 transition-all"
          >
            다음
            <i className="fa-solid fa-chevron-right text-[10px]" />
          </button>
        </div>
      )}
    </div>
  );
};

export default HospitalRenderer;
