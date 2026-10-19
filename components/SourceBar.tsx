import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GroundingSource, Language } from '../types';

/**
 * 출처 칩 favicon 도메인. Gemini grounding 링크는 전부 `vertexaisearch.cloud.google.com`
 * 경유라 호스트로 고르면 12개가 모두 구글 G 가 된다. 이때 제목 자리에 오는 도메인
 * ("chosun.com")을 쓴다. 제목이 도메인 꼴이 아니면 원래 호스트로 둔다.
 */
const faviconDomain = (source: { uri: string; title?: string }): string => {
  let host = '';
  try { host = new URL(source.uri).hostname; } catch { /* 잘못된 URI — 아래 폴백 */ }
  const title = (source.title || '').trim().toLowerCase();
  if (host.endsWith('vertexaisearch.cloud.google.com') && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(title)) return title;
  return host;
};

const faviconUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

/** 이 개수부터 칩 나열 대신 접힌 바 하나로 보여준다(실측 10-19: 답변의 약 40%가 3개 이상, 최대 14). */
const COLLAPSE_AT = 3;

const i18n = {
  ko: { sources: (n: number) => `출처 ${n}개`, extra: '참고한 출처', close: '닫기' },
  en: { sources: (n: number) => `${n} sources`, extra: 'Also consulted', close: 'Close' },
  es: { sources: (n: number) => `${n} fuentes`, extra: 'También consultadas', close: 'Cerrar' },
  fr: { sources: (n: number) => `${n} sources`, extra: 'Également consultées', close: 'Fermer' },
};

const isValidUri = (uri: string) => { try { new URL(uri); return true; } catch { return false; } };

const SourceChip: React.FC<{ source: GroundingSource }> = ({ source }) => (
  <a
    href={source.uri}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center px-4 py-2 rounded-full bg-slate-50 dark:bg-white/[0.07] border border-slate-200 dark:border-white/10 hover:border-primary-500 dark:hover:border-primary-400/60 transition-all group"
  >
    <img src={faviconUrl(faviconDomain(source))} alt="" className="w-3.5 h-3.5 mr-2" />
    {source.citationNumber && (
      <span className="mr-1.5 text-[10px] font-black text-primary-600 dark:text-primary-400">[{source.citationNumber}]</span>
    )}
    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate max-w-[150px]">{source.title}</span>
  </a>
);

const SourceRow: React.FC<{ source: GroundingSource; numbered: boolean }> = ({ source, numbered }) => {
  const domain = faviconDomain(source);
  const title = (source.title || '').trim() || domain || source.uri;
  // Gemini 출처는 제목 자리에 도메인만 온다 — 같은 글자를 두 줄로 반복하지 않는다.
  const bare = (x: string) => x.toLowerCase().replace(/^www\./, '');
  const showDomain = domain && bare(domain) !== bare(title);
  return (
    <a
      href={source.uri}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.07] transition-colors"
    >
      {/* 번호 칸은 목록에 인용 번호가 하나라도 있을 때만 — 전부 없으면 빈 칸만 남는다 */}
      {numbered && (
        <span className="w-7 shrink-0 text-[11px] font-black text-primary-600 dark:text-primary-300">
          {source.citationNumber ? `[${source.citationNumber}]` : ''}
        </span>
      )}
      <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-md dark:bg-white/90"><img src={faviconUrl(domain)} alt="" className="w-4 h-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-slate-700 dark:text-slate-100 line-clamp-2" style={{ overflowWrap: 'anywhere' }}>{title}</span>
        {showDomain && <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{domain}</span>}
      </span>
      <i className="fa-solid fa-arrow-up-right-from-square shrink-0 text-[11px] text-slate-400" aria-hidden="true" />
    </a>
  );
};

/**
 * 답변 아래 출처 표시. 1~2개는 칩, 3개 이상은 접힌 바 하나 → 누르면 전체 목록
 * (모바일 하단 시트 · 데스크톱 가운데 창). 인용 번호는 원래 citationNumber 를 쓰고 새로 매기지 않는다.
 */
const SourceBar: React.FC<{ sources: GroundingSource[]; language?: Language }> = ({ sources, language = 'ko' }) => {
  const t = i18n[language as keyof typeof i18n] || i18n.ko;
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const valid = sources.filter(s => isValidUri(s.uri));

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); barRef.current?.focus(); };
  }, [open]);

  if (valid.length === 0) return null;
  if (valid.length < COLLAPSE_AT) return <>{valid.map((s, i) => <SourceChip key={`${s.uri}-${i}`} source={s} />)}</>;

  const cited = valid.filter(s => s.citationNumber).sort((a, b) => a.citationNumber! - b.citationNumber!);
  const uncited = valid.filter(s => !s.citationNumber);
  // 바에는 서로 다른 도메인 favicon 3개 — 같은 사이트가 여럿이면(실측 답변의 1/4) 아이콘이 겹쳐 보인다.
  const icons = [...new Set([...cited, ...uncited].map(faviconDomain).filter(Boolean))].slice(0, 3);

  return (
    <>
      <button
        ref={barRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-full bg-slate-50 dark:bg-white/[0.07] border border-slate-200 dark:border-white/10 hover:border-primary-500 dark:hover:border-primary-400/60 dark:hover:bg-white/[0.1] transition-all"
      >
        <span className="flex -space-x-1.5">
          {icons.map(d => (
            <img key={d} src={faviconUrl(d)} alt="" className="w-4 h-4 rounded-full bg-white ring-2 ring-slate-50 dark:ring-slate-700" />
          ))}
        </span>
        <span className="text-[12px] font-medium text-slate-600 dark:text-slate-200">{t.sources(valid.length)}</span>
        <i className="fa-solid fa-chevron-down text-[10px] text-slate-400" aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center sm:p-6">
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm modal-backdrop-in" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-sheet-title"
            className="relative w-full sm:max-w-md max-h-[85dvh] flex flex-col bg-white dark:bg-[#1c2238] rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.35)] modal-panel-in"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20 sm:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <h2 id="source-sheet-title" className="text-[15px] font-bold text-slate-800 dark:text-white">{t.sources(valid.length)}</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.close}
                className="flex items-center justify-center w-11 h-11 -mr-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5"
              >
                <i className="fa-solid fa-xmark text-[16px]" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-2 pb-3">
              {cited.map((s, i) => <SourceRow key={`${s.uri}-${i}`} source={s} numbered />)}
              {uncited.length > 0 && (
                <>
                  {cited.length > 0 && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t.extra}</div>}
                  {uncited.map((s, i) => <SourceRow key={`${s.uri}-u${i}`} source={s} numbered={cited.length > 0} />)}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default SourceBar;
