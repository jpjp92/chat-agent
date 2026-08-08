import React, { useEffect, useMemo, useState } from 'react';

interface LawListItem {
  name: string;
  shortName?: string;
  lawId?: string;
  mst?: string;
  type?: string;
  department?: string;
  promulgationNo?: string;
  promulgationDate?: string;
  effectiveDate?: string;
  revisionType?: string;
  status?: string;
  preview?: string;
  sourceUrl?: string;
}

interface LawClause {
  number: string;
  text: string;
  subItems?: { number: string; text: string }[];
}

interface LawArticle {
  number: string;
  title?: string;
  text?: string;
  effectiveDate?: string;
  changed?: boolean;
  sourceUrl?: string;
  clauses?: LawClause[];
}

interface LawPayload {
  query: string;
  mode: 'list' | 'body' | 'article';
  count?: number;
  laws?: LawListItem[];
  law?: LawListItem;
  articleNo?: string;
  articles?: LawArticle[];
}

type Lang = 'ko' | 'en' | 'es' | 'fr';

/** mode 는 서버가 주는 계약값(list·body·article) — 키는 그대로, 라벨만 언어별. */
const MODE_LABEL: Record<Lang, Record<string, string>> = {
  ko: { list: '법령 목록', body: '법령 본문', article: '조문 조회' },
  en: { list: 'Statute list', body: 'Statute text', article: 'Article lookup' },
  es: { list: 'Lista de leyes', body: 'Texto de la ley', article: 'Consulta de artículo' },
  fr: { list: 'Liste des lois', body: 'Texte de loi', article: 'Consultation d\'article' },
};

const T: Record<Lang, Record<string, string>> = {
  ko: { fallbackTitle: '법령정보', fallbackMode: '법령 조회', countSuffix: '건', noDept: '소관부처 정보 없음', totalPrefix: '전체', totalSuffix: '개 법령' },
  en: { fallbackTitle: 'Statute info', fallbackMode: 'Statute lookup', countSuffix: '', noDept: 'No ministry info', totalPrefix: '', totalSuffix: 'statutes total' },
  es: { fallbackTitle: 'Información legal', fallbackMode: 'Consulta legal', countSuffix: '', noDept: 'Sin información del ministerio', totalPrefix: '', totalSuffix: 'leyes en total' },
  fr: { fallbackTitle: 'Informations légales', fallbackMode: 'Consultation légale', countSuffix: '', noDept: 'Aucune information ministérielle', totalPrefix: '', totalSuffix: 'lois au total' },
};

const ITEMS_PER_PAGE = 5;

export const LawRenderer: React.FC<{ data: LawPayload; language?: Lang }> = ({ data, language = 'ko' }) => {
  const lang: Lang = (['ko', 'en', 'es', 'fr'].includes(language as string) ? language : 'ko') as Lang;
  const tt = T[lang];
  const modeLabel = MODE_LABEL[lang];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [articlePage, setArticlePage] = useState(0);
  const [lawPage, setLawPage] = useState(0);
  const laws = data.laws || [];
  const articles = data.articles || [];
  const totalLawPages = Math.max(1, Math.ceil(laws.length / ITEMS_PER_PAGE));
  const currentLawPage = Math.min(lawPage, totalLawPages - 1);
  const lawPageStart = currentLawPage * ITEMS_PER_PAGE;
  const visibleLaws = useMemo(
    () => laws.slice(lawPageStart, lawPageStart + ITEMS_PER_PAGE),
    [laws, lawPageStart]
  );
  const totalArticlePages = Math.max(1, Math.ceil(articles.length / ITEMS_PER_PAGE));
  const currentArticlePage = Math.min(articlePage, totalArticlePages - 1);
  const articlePageStart = currentArticlePage * ITEMS_PER_PAGE;
  const visibleArticles = useMemo(
    () => articles.slice(articlePageStart, articlePageStart + ITEMS_PER_PAGE),
    [articles, articlePageStart]
  );

  useEffect(() => {
    setLawPage(0);
    setArticlePage(0);
    setExpanded({});
  }, [data.query, data.mode, data.articleNo, laws.length, articles.length]);

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="my-4 w-full max-w-full min-w-0 box-border overflow-hidden rounded-2xl border border-amber-200/70 dark:border-amber-400/20 bg-white/80 dark:bg-slate-950/70 shadow-sm backdrop-blur-sm">
      <div className="px-4 py-3 border-b border-amber-100/80 dark:border-amber-400/10 bg-amber-50/80 dark:bg-amber-400/10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-scale-balanced text-amber-600 dark:text-amber-300" />
              <h3 className="font-bold text-slate-900 dark:text-white truncate">
                {data.law?.name || data.query || tt.fallbackTitle}
              </h3>
            </div>
            <p className="mt-1 text-xs font-medium text-amber-700/80 dark:text-amber-200/80">
              {modeLabel[data.mode] || tt.fallbackMode}
              {data.mode === 'list' && data.count ? ` · ${data.count}${tt.countSuffix}` : ''}
              {data.law?.department ? ` · ${data.law.department}` : ''}
              {data.law?.effectiveDate ? ` · 시행 ${data.law.effectiveDate}` : ''}
            </p>
          </div>
          {data.law?.sourceUrl && (
            <a
              href={data.law.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg bg-white/80 dark:bg-white/10 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-200 hover:bg-white dark:hover:bg-white/15"
            >
              원문
            </a>
          )}
        </div>
      </div>

      {data.mode === 'list' && (
        <div className="p-3 space-y-2 min-w-0">
          {visibleLaws.map((law, index) => (
            <div
              key={`${law.lawId}-${law.mst}-${lawPageStart + index}`}
              className="rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-slate-800 dark:text-slate-100 break-words">
                      {law.name}
                    </p>
                    {law.type && (
                      <span className="rounded-md bg-amber-100/80 dark:bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-200">
                        {law.type}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {[law.department, law.revisionType].filter(Boolean).join(' · ') || tt.noDept}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
                    <span>시행 {law.effectiveDate || '-'}</span>
                    <span>공포 {law.promulgationDate || '-'}</span>
                    {law.promulgationNo && <span>공포번호 {law.promulgationNo}</span>}
                  </div>
                </div>
                {law.sourceUrl && (
                  <a
                    href={law.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg border border-amber-200/80 dark:border-amber-300/20 px-2.5 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-400/10"
                  >
                    원문
                  </a>
                )}
              </div>
            </div>
          ))}
          {laws.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setLawPage(page => Math.max(0, page - 1))}
                disabled={currentLawPage === 0}
                className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                이전
              </button>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {currentLawPage + 1} / {totalLawPages} · {tt.totalPrefix} {laws.length} {tt.totalSuffix}
              </p>
              <button
                type="button"
                onClick={() => setLawPage(page => Math.min(totalLawPages - 1, page + 1))}
                disabled={currentLawPage >= totalLawPages - 1}
                className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                다음
              </button>
            </div>
          )}
        </div>
      )}

      {data.mode !== 'list' && (
        <div className="p-4 space-y-3 min-w-0">
          {visibleArticles.map((article, index) => {
            const absoluteIndex = articlePageStart + index;
            const key = `${article.number}-${absoluteIndex}`;
            const isOpen = expanded[key] ?? index === 0;
            return (
              <section key={key} className="w-full max-w-full min-w-0 rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/[0.03]">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="w-full min-w-0 px-4 py-3 flex items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 dark:text-slate-100 break-words">
                      제{article.number}조{article.title ? ` (${article.title})` : ''}
                    </p>
                    {article.effectiveDate && (
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">시행 {article.effectiveDate}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    {article.sourceUrl && (
                      <a
                        href={article.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="text-xs font-bold text-amber-600 dark:text-amber-300 hover:underline"
                      >
                        원문
                      </a>
                    )}
                    <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs text-slate-400`} />
                  </div>
                </button>
                {isOpen && (
                  <div className="min-w-0 px-4 pb-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed break-words">
                    {article.text && (
                      <p className="mb-3 rounded-lg bg-amber-50/80 dark:bg-amber-400/10 px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                        {article.text}
                      </p>
                    )}
                    <div className="space-y-2">
                      {(article.clauses || []).map((clause, clauseIndex) => (
                        <div key={`${key}-clause-${clauseIndex}`} className="rounded-lg bg-slate-50 dark:bg-white/[0.04] px-3 py-2">
                          <p>{clause.text}</p>
                          {clause.subItems && clause.subItems.length > 0 && (
                            <ul className="mt-2 ml-4 list-disc space-y-1 text-xs text-slate-600 dark:text-slate-400">
                              {clause.subItems.map((item, itemIndex) => (
                                <li key={`${key}-item-${itemIndex}`}>{item.text}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          {articles.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setArticlePage(page => Math.max(0, page - 1))}
                disabled={currentArticlePage === 0}
                className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                이전
              </button>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {currentArticlePage + 1} / {totalArticlePages} · 전체 {articles.length}개 조문
              </p>
              <button
                type="button"
                onClick={() => setArticlePage(page => Math.min(totalArticlePages - 1, page + 1))}
                disabled={currentArticlePage >= totalArticlePages - 1}
                className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                다음
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LawRenderer;
