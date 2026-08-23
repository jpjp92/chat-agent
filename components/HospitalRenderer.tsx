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
  notice?: string;
}

interface HospitalRendererProps {
  data: HospitalData;
  language?: Lang;
}

const PAGE_SIZE = 5;

export type Lang = 'ko' | 'en' | 'es' | 'fr';

/**
 * 🔴 HIRA API 계약값 — 종별 문자열. **번역 금지.**
 * 아래 TYPE_STYLE 의 키이자 h.type.includes(...) 비교에 쓰인다. 언어별로 바꾸면
 * 색상 매핑과 분기가 통째로 깨진다. 화면 표시는 TYPE_LABEL 로 따로 옮긴다.
 */
const API_TERTIARY = '상급종합';
const API_TERTIARY_FULL = '상급종합병원';
const API_GENERAL = '종합병원';
const API_HOSPITAL = '병원';
const API_CLINIC = '의원';

/** 종별 **분류값**의 표시 라벨. 고유명사가 아니므로 번역 대상. 미지값은 원문 통과. */
const TYPE_LABEL: Record<Lang, Record<string, string>> = {
  ko: {},
  en: { [API_TERTIARY]: 'Tertiary', [API_TERTIARY_FULL]: 'Tertiary hospital', [API_GENERAL]: 'General hospital', [API_HOSPITAL]: 'Hospital', [API_CLINIC]: 'Clinic' },
  es: { [API_TERTIARY]: 'Terciario', [API_TERTIARY_FULL]: 'Hospital terciario', [API_GENERAL]: 'Hospital general', [API_HOSPITAL]: 'Hospital', [API_CLINIC]: 'Consultorio' },
  fr: { [API_TERTIARY]: 'Tertiaire', [API_TERTIARY_FULL]: 'Hôpital tertiaire', [API_GENERAL]: 'Hôpital général', [API_HOSPITAL]: 'Hôpital', [API_CLINIC]: 'Cabinet' },
};

const T: Record<Lang, Record<string, string>> = {
  ko: { notFound: '병원 정보를 찾을 수 없습니다.', search: '병원 검색', top: '상위', results: '결과 (의사수 기준)', count: '개', doctors: '의사 {n}명', established: '{d} 개설', prev: '이전', next: '다음', mapTitle: '카카오지도에서 보기', siteTitle: '병원 홈페이지', phone: '전화번호' },
  en: { notFound: 'No hospitals found.', search: 'hospital search', top: 'Top', results: 'results (by doctor count)', count: '', doctors: '{n} doctors', established: 'est. {d}', prev: 'Prev', next: 'Next', mapTitle: 'View on Kakao Map', siteTitle: 'Hospital website', phone: 'Phone' },
  es: { notFound: 'No se encontraron hospitales.', search: 'búsqueda de hospitales', top: 'Top', results: 'resultados (por número de médicos)', count: '', doctors: '{n} médicos', established: 'fund. {d}', prev: 'Anterior', next: 'Siguiente', mapTitle: 'Ver en Kakao Map', siteTitle: 'Sitio web del hospital', phone: 'Teléfono' },
  fr: { notFound: 'Aucun hôpital trouvé.', search: "recherche d'hôpitaux", top: 'Top', results: 'résultats (par nombre de médecins)', count: '', doctors: '{n} médecins', established: 'créé {d}', prev: 'Précédent', next: 'Suivant', mapTitle: 'Voir sur Kakao Map', siteTitle: "Site web de l'hôpital", phone: 'Téléphone' },
};

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

const TYPE_STYLE: Record<string, { bg: string; text: string }> = {
  [API_TERTIARY]: { bg: 'bg-violet-500/10 border border-violet-500/20', text: 'text-violet-400' },
  [API_TERTIARY_FULL]: { bg: 'bg-violet-500/10 border border-violet-500/20', text: 'text-violet-400' },
  [API_GENERAL]: { bg: 'bg-blue-500/10 border border-blue-500/20', text: 'text-blue-400' },
  [API_HOSPITAL]: { bg: 'bg-sky-500/10 border border-sky-500/20', text: 'text-sky-400' },
  [API_CLINIC]: { bg: 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10', text: 'text-slate-400' },
};

const getTypeStyle = (type: string) =>
  TYPE_STYLE[type] ?? { bg: 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10', text: 'text-slate-400' };

const kakaoMapUrl = (lat: number, lon: number, name: string) =>
  `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lon}`;

export const HospitalRenderer: React.FC<HospitalRendererProps> = ({ data, language = 'ko' }) => {
  const lang: Lang = (['ko', 'en', 'es', 'fr'].includes(language as string) ? language : 'ko') as Lang;
  const tt = T[lang];
  const typeLabel = (raw: string) => TYPE_LABEL[lang][raw] ?? raw;
  const [page, setPage] = useState(0);

  const handlePhoneClick = (e: React.MouseEvent<HTMLAnchorElement>, phone: string) => {
    e.stopPropagation();
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) {
      e.preventDefault();
      navigator.clipboard.writeText(phone).catch(() => {});
      window.dispatchEvent(new CustomEvent('custom-toast', {
        detail: { message: `📞 ${tt.phone}: ${phone}`, type: 'success' }
      }));
    }
  };

  if (!data?.hospitals?.length) {
    return (
      <div className="my-4 p-6 rounded-3xl bg-white/5 border border-white/10 text-center text-slate-400">
        <i className="fa-solid fa-hospital-slash text-2xl mb-2 block" />
        <p className="text-sm">{data?.notice || tt.notFound}</p>
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
            {data.query} {tt.search}
          </h3>
          <p className="text-[11px] text-slate-400">
            {tt.top} <span className="font-bold text-blue-400">{data.hospitals.length}{tt.count}</span> {tt.results}
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
                h.type.includes(API_TERTIARY) ? 'bg-violet-500' :
                h.type.includes(API_GENERAL) ? 'bg-blue-500' :
                h.type.includes(API_HOSPITAL) ? 'bg-sky-400' : 'bg-slate-400'
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
                        {typeLabel(h.type)}
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
                            {fill(tt.doctors, { n: h.doctor_count.toLocaleString() })}
                          </span>
                        </div>
                      )}
                      {h.established && (
                        <div className="flex items-center gap-1">
                          <i className="fa-regular fa-calendar text-[9px] sm:text-[10px] text-slate-400" />
                          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {fill(tt.established, { d: h.established })}
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
                        title={tt.mapTitle}
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
                        title={tt.siteTitle}
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
            {tt.prev}
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
            {tt.next}
            <i className="fa-solid fa-chevron-right text-[10px]" />
          </button>
        </div>
      )}
    </div>
  );
};

export default HospitalRenderer;
