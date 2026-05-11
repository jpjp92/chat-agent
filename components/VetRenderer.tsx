import React, { useState } from 'react';

interface Vet {
  name: string;
  address: string;
  phone: string;
  status: string;
  status_detail: string;
  license_date: string;
}

interface VetData {
  query: string;
  count: number;
  vets: Vet[];
}

interface VetRendererProps {
  data: VetData;
}

const PAGE_SIZE = 5;

const kakaoMapUrl = (name: string, address: string) =>
  `https://map.kakao.com/link/search/${encodeURIComponent(name + ' ' + address.split(' ').slice(0, 3).join(' '))}`;

export const VetRenderer: React.FC<VetRendererProps> = ({ data }) => {
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

  if (!data?.vets?.length) {
    return (
      <div className="my-4 p-6 rounded-3xl bg-white/5 border border-white/10 text-center text-slate-400">
        <i className="fa-solid fa-paw text-2xl mb-2 block" />
        <p className="text-sm">동물병원 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.vets.length / PAGE_SIZE);
  const pageItems = data.vets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="my-4 w-full">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
          <i className="fa-solid fa-paw text-white text-xs" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {data.query} 동물병원 검색
          </h3>
          <p className="text-[11px] text-slate-400">
            상위 <span className="font-bold text-teal-400">{data.vets.length}개</span> 결과 (가나다 순)
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 w-full">
        {pageItems.map((v, i) => {
          const isOpen = v.status === '영업' || v.status === '영업중';
          const isClosed = v.status.includes('폐업') || v.status_detail.includes('폐업');

          return (
            <div
              key={`${v.name}-${i}`}
              className="relative w-full rounded-2xl border border-white/10 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl overflow-hidden"
            >
              {/* Left accent stripe */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${
                isClosed ? 'bg-slate-400' : isOpen ? 'bg-teal-500' : 'bg-amber-400'
              }`} />

              <div className="pl-4 pr-3 sm:pl-5 sm:pr-4 py-3 sm:py-4">
                <div className="flex items-start justify-between gap-2 w-full min-w-0">
                  {/* Left: info */}
                  <div className="min-w-0 flex-1">
                    {/* Name + status badge */}
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white truncate max-w-[160px] sm:max-w-[320px] lg:max-w-[540px]">
                        {v.name}
                      </span>
                      {v.status && (
                        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold border ${
                          isClosed
                            ? 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400'
                            : isOpen
                            ? 'bg-teal-500/10 border-teal-500/20 text-teal-400'
                            : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                        }`}>
                          {v.status_detail || v.status}
                        </span>
                      )}
                    </div>

                    {/* Address */}
                    <p className="text-[11px] sm:text-[12px] text-slate-500 dark:text-slate-400 truncate leading-snug">
                      {v.address}
                    </p>

                    {/* License date */}
                    {v.license_date && (
                      <div className="mt-1 flex items-center gap-1">
                        <i className="fa-regular fa-calendar text-[9px] sm:text-[10px] text-slate-400" />
                        <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {v.license_date} 개설
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right: action buttons */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {v.phone && (
                      <a
                        href={`tel:${v.phone}`}
                        onClick={e => handlePhoneClick(e, v.phone)}
                        className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-teal-500/10 hover:text-teal-500 text-slate-500 dark:text-slate-400 transition-colors"
                        title={v.phone}
                      >
                        <i className="fa-solid fa-phone text-[10px]" />
                      </a>
                    )}
                    {v.address && (
                      <a
                        href={kakaoMapUrl(v.name, v.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-yellow-400/10 hover:text-yellow-500 text-slate-500 dark:text-slate-400 transition-colors"
                        title="카카오지도에서 보기"
                      >
                        <i className="fa-solid fa-location-dot text-[10px]" />
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-30 hover:enabled:bg-teal-500/10 hover:enabled:text-teal-500 hover:enabled:border-teal-400/30 transition-all"
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
                    ? 'bg-teal-500 text-white shadow-md shadow-teal-500/30'
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 disabled:opacity-30 hover:enabled:bg-teal-500/10 hover:enabled:text-teal-500 hover:enabled:border-teal-400/30 transition-all"
          >
            다음
            <i className="fa-solid fa-chevron-right text-[10px]" />
          </button>
        </div>
      )}
    </div>
  );
};

export default VetRenderer;
