import React, { useState } from 'react';

type EvidenceLevel = 'meta-analysis' | 'rct' | 'review';
type Source = 'pubmed' | 'arxiv';

interface Paper {
    /** PubMed 전용 */
    pmid?: string;
    /** arXiv 전용 */
    arxivId?: string;
    title: string;
    journal?: string;
    year?: string;
    authors?: string[];
    /** PubMed 큐레이션 등급. arXiv 에는 존재하지 않는다. */
    evidence?: EvidenceLevel | null;
    /** PubMed 가 철회로 표시한 논문 */
    retracted?: boolean;
    /** arXiv 1차 분류(cs.LG, econ.EM …) */
    category?: string;
    /** arXiv: 저널 게재 판본이 확인되는가 */
    published?: boolean;
    doi?: string | null;
    url: string;
    summary?: string;
    /** 요약이 진짜 결론인가(`conclusion`), 위치로 추측한 발췌인가(`excerpt`), 초록이 없나(`none`). */
    summaryKind?: 'conclusion' | 'excerpt' | 'none' | null;
}

interface PaperData {
    query: string;
    /** 없으면 pubmed — 이 필드가 생기기 전 카드와의 호환. */
    source?: Source;
    total?: number;
    papers: Paper[];
    /**
     * 철회되어 근거 목록에서 제외된 논문. 인용 번호 [n] 은 `papers` 의 순번이라
     * 여기 있는 논문은 **모델이 번호로 가리킬 수 없다**(도구가 분리해서 보낸다).
     */
    retracted?: Paper[];
    /**
     * PubMed 에 초록이 없어 요약할 수 없는 논문(실측 8%). 철회와 같은 이유로 번호 목록에서
     * 빼지만 **같은 칸에 담지 않는다** — 철회는 "믿지 마라", 이건 "우리가 요약을 못 한다" 다.
     */
    noAbstract?: Paper[];
    error?: string;
}

interface PaperRendererProps {
    data: PaperData;
    language?: 'ko' | 'en' | 'es' | 'fr';
}

type Lang = NonNullable<PaperRendererProps['language']>;

const PAGE_SIZE = 5;

const T: Record<Lang, {
    heading: string; found: string; of: string; notFound: string;
    disclaimer: Record<Source, string>; prev: string; next: string; authorsMore: string;
    peerReviewed: string; preprint: string;
    retracted: string; excerpt: string; noAbstract: string;
    excludedTitle: string; excludedNote: string;
    noAbstractTitle: string; noAbstractNote: string;
    lookupFailed: string; lookupFailedNote: Record<Source, string>;
}> = {
    ko: {
        heading: '근거 논문',
        found: '건', of: '중 관련도 상위',
        notFound: '조건에 맞는 논문을 찾지 못했습니다.',
        disclaimer: {
            pubmed: 'PubMed(의생명 분야 문헌)에서 찾은 연구 요약이며 진료 조언이 아닙니다. 배지는 PubMed 가 연구 유형을 분류한 논문에만 표시됩니다.',
            arxiv: 'arXiv(물리·수학·전산·통계·경제 분야)에서 찾은 요약입니다. arXiv 는 프리프린트 저장소라 동료심사를 거치지 않은 글이 포함되며, 배지는 저널 게재 판본이 확인되는지만 나타냅니다.',
        },
        prev: '이전', next: '다음', authorsMore: '외 {n}명',
        peerReviewed: '게재됨', preprint: '프리프린트',
        retracted: '철회됨',
        lookupFailed: '논문을 조회하지 못했습니다', lookupFailedNote: { pubmed: 'PubMed 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.', arxiv: 'arXiv 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        noAbstractTitle: '초록이 없어 요약하지 못한 논문', noAbstractNote: 'PubMed 에 초록이 등록돼 있지 않아 내용을 요약할 수 없었습니다. 논문 자체의 문제가 아니니 원문을 직접 확인해 보세요.',
        excludedTitle: '철회되어 제외된 논문', excludedNote: '철회된 논문은 근거 목록에서 빼두었습니다. 다른 곳에서 이 논문을 보더라도 결과를 신뢰하지 마세요.',
        excerpt: '초록 발췌', noAbstract: '초록이 공개되지 않은 논문입니다.',
    },
    en: {
        heading: 'Supporting research',
        found: '', of: 'results · showing top',
        notFound: 'No matching studies were found.',
        disclaimer: {
            pubmed: 'Research summaries from PubMed (biomedical literature only), not medical advice. Badges appear only when PubMed has classified the study type.',
            arxiv: 'Summaries from arXiv (physics, maths, computing, statistics, economics). arXiv is a preprint server, so some entries are not peer reviewed; the badge only says whether a published journal version exists.',
        },
        prev: 'Prev', next: 'Next', authorsMore: '+{n} more',
        peerReviewed: 'Published', preprint: 'Preprint',
        retracted: 'Retracted',
        lookupFailed: 'Could not reach the database', lookupFailedNote: { pubmed: 'No response from PubMed. Please try again in a moment.', arxiv: 'No response from arXiv. Please try again in a moment.' },
        noAbstractTitle: 'No abstract — not summarised', noAbstractNote: 'PubMed holds no abstract for these, so they could not be summarised. That is a gap in the record, not a flaw in the paper — open the original to read it.',
        excludedTitle: 'Excluded — retracted', excludedNote: 'Retracted papers are kept out of the evidence list. If you meet one elsewhere, do not rely on its results.',
        excerpt: 'Abstract excerpt', noAbstract: 'No abstract is available for this paper.',
    },
    es: {
        heading: 'Estudios de referencia',
        found: '', of: 'resultados · mostrando',
        notFound: 'No se encontraron estudios coincidentes.',
        disclaimer: {
            pubmed: 'Resúmenes de PubMed (solo literatura biomédica), no consejo médico. Las etiquetas solo aparecen si PubMed clasificó el estudio.',
            arxiv: 'Resúmenes de arXiv (física, matemáticas, computación, estadística, economía). arXiv es un repositorio de preprints, así que algunos textos no tienen revisión por pares; la etiqueta solo indica si existe una versión publicada en revista.',
        },
        prev: 'Anterior', next: 'Siguiente', authorsMore: '+{n} más',
        peerReviewed: 'Publicado', preprint: 'Preprint',
        retracted: 'Retractado',
        lookupFailed: 'No se pudo consultar la base', lookupFailedNote: { pubmed: 'PubMed no respondió. Inténtelo de nuevo en un momento.', arxiv: 'arXiv no respondió. Inténtelo de nuevo en un momento.' },
        noAbstractTitle: 'Sin resumen — no sintetizados', noAbstractNote: 'PubMed no tiene resumen de estos artículos, así que no se pudieron sintetizar. Es una laguna del registro, no un defecto del artículo: consulte el original.',
        excludedTitle: 'Excluidos por retractación', excludedNote: 'Los artículos retractados quedan fuera de la lista de evidencia. Si los encuentra en otro sitio, no confíe en sus resultados.',
        excerpt: 'Extracto del resumen', noAbstract: 'Este artículo no tiene resumen disponible.',
    },
    fr: {
        heading: 'Études de référence',
        found: '', of: 'résultats · affichage',
        notFound: 'Aucune étude correspondante trouvée.',
        disclaimer: {
            pubmed: "Résumés issus de PubMed (littérature biomédicale uniquement), pas un avis médical. Les badges n'apparaissent que si PubMed a classé l'étude.",
            arxiv: "Résumés issus d'arXiv (physique, mathématiques, informatique, statistiques, économie). arXiv est un dépôt de prépublications : certains textes ne sont pas relus par les pairs ; le badge indique seulement s'il existe une version publiée en revue.",
        },
        prev: 'Précédent', next: 'Suivant', authorsMore: '+{n} autres',
        peerReviewed: 'Publié', preprint: 'Prépublication',
        retracted: 'Rétracté',
        lookupFailed: 'Base de données injoignable', lookupFailedNote: { pubmed: 'Aucune réponse de PubMed. Réessayez dans un instant.', arxiv: "Aucune réponse d'arXiv. Réessayez dans un instant." },
        noAbstractTitle: 'Sans résumé — non synthétisés', noAbstractNote: "PubMed ne contient aucun résumé pour ces articles ; ils n'ont donc pas pu être synthétisés. C'est une lacune de la notice, pas un défaut de l'article — consultez l'original.",
        excludedTitle: 'Exclus — rétractés', excludedNote: 'Les articles rétractés sont écartés de la liste de preuves. Si vous en croisez un ailleurs, ne vous fiez pas à ses résultats.',
        excerpt: 'Extrait du résumé', noAbstract: 'Aucun résumé disponible pour cet article.',
    },
};

/**
 * 근거 등급 배지.
 *
 * 🔴 문구는 학술 용어가 아니라 일상어다. '종설'·'무작위 대조시험'은 학계 밖에서 안 통한다.
 * 색 위계(violet > blue > sky)는 json:hospital 의 종별 규칙을 그대로 재사용했다.
 *
 * `evidence: null` 이면 **아무것도 그리지 않는다.** 실측상 약 35%가 여기 해당하는데,
 * 미분류는 "등급이 낮다"가 아니라 "아직 분류가 안 됐다"는 뜻이라 최하위처럼 보이는 칩을
 * 달면 사실과 반대되는 신호가 된다(DEV_260830 §3.2). 같은 이유로
 * 좌측 색 스트라이프도 쓰지 않는다 — 띠로 서열을 그리면 배지 없는 카드가 꼴찌로 읽힌다.
 */
const EVIDENCE_STYLE: Record<EvidenceLevel, { label: Record<Lang, string>; className: string }> = {
    'meta-analysis': {
        label: { ko: '종합분석', en: 'Pooled analysis', es: 'Análisis combinado', fr: 'Analyse groupée' },
        className: 'bg-violet-100/80 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200',
    },
    rct: {
        label: { ko: '임상시험', en: 'Clinical trial', es: 'Ensayo clínico', fr: 'Essai clinique' },
        className: 'bg-blue-100/80 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200',
    },
    review: {
        label: { ko: '논문 리뷰', en: 'Review', es: 'Revisión', fr: 'Revue' },
        className: 'bg-sky-100/80 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200',
    },
};

/**
 * arXiv 배지.
 *
 * 🔴 PubMed 의 근거 등급(EVIDENCE_STYLE)을 **재사용하면 안 된다.** 저건 NLM 큐레이터가 연구
 * 설계를 분류한 값이고, arXiv 에는 그런 분류가 아예 없다. 여기서 말할 수 있는 사실은 하나뿐이다
 * — 저널 게재 판본이 확인되는가(`journal_ref`/`doi` 존재). 그래서 색으로 서열을 만들지 않고
 * 게재/프리프린트만 구분한다. 프리프린트를 회색으로 두는 건 "낮은 등급"이 아니라 "심사 전"이라는
 * 중립 신호다 — 그 사실을 숨기면 심사 안 된 글이 심사된 것처럼 읽힌다.
 */
const ARXIV_BADGE = {
    published: 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200',
    preprint: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300',
} as const;

const formatAuthors = (authors: string[] | undefined, moreTpl: string): string => {
    if (!authors?.length) return '';
    if (authors.length <= 3) return authors.join(', ');
    return `${authors.slice(0, 3).join(', ')} ${moreTpl.replace('{n}', String(authors.length - 3))}`;
};

export const PaperRenderer: React.FC<PaperRendererProps> = ({ data, language = 'ko' }) => {
    const lang: Lang = (['ko', 'en', 'es', 'fr'].includes(language as string) ? language : 'ko') as Lang;
    const tt = T[lang];
    const [page, setPage] = useState(0);

    // source 가 없는 카드는 PubMed 다 — arXiv 를 붙이기 전에 만들어진 카드와의 호환.
    const source: Source = data?.source === 'arxiv' ? 'arxiv' : 'pubmed';
    const papers = data?.papers ?? [];
    const retracted = data?.retracted ?? [];
    const noAbstract = data?.noAbstract ?? [];

    if (!papers.length && !retracted.length && !noAbstract.length) {
        /**
         * 🔴 **조회 실패를 0건으로 말하지 않는다.** PubMed 가 죽어서 아무것도 못 받은 것과
         * 조건에 맞는 논문이 정말 없는 것은 사용자에게 정반대 뜻이다 — 앞은 다시 시도하면
         * 되고, 뒤는 근거가 없다는 판단이다. `error` 를 선언만 해두고 안 그리던 탓에
         * PubMed 장애가 "찾지 못했습니다" 로 나갔다. 심평원에서 같은 병을 이미 고쳤다.
         */
        const failed = Boolean(data?.error);
        return (
            <div className="my-4 rounded-2xl border border-slate-200 bg-white/60 p-6 text-center text-slate-400 dark:border-white/10 dark:bg-white/5">
                <i className={`${failed ? 'fa-solid fa-circle-exclamation' : 'fa-regular fa-file-lines'} mb-2 block text-2xl`} />
                <p className="text-sm">{failed ? tt.lookupFailed : tt.notFound}</p>
                {failed && <p className="mt-1 text-xs">{tt.lookupFailedNote[source]}</p>}
            </div>
        );
    }

    const totalPages = Math.ceil(papers.length / PAGE_SIZE);
    const pageItems = papers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    return (
        <div className="my-4 w-full">
            {/* 헤더 */}
            <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20">
                    <i className="fa-solid fa-file-lines text-xs text-white" />
                </div>
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {data.query ? `${data.query} · ${tt.heading}` : tt.heading}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                        {source === 'arxiv' ? 'arXiv' : 'PubMed'}{' '}
                        <span className="font-bold tabular-nums text-violet-500 dark:text-violet-400">
                            {(data.total ?? papers.length).toLocaleString()}{tt.found}
                        </span>{' '}
                        {tt.of} {papers.length}{tt.found}
                    </p>
                </div>
            </div>

            {/* 목록 */}
            <div className="flex w-full flex-col gap-2">
                {pageItems.map(paper => {
                    const evidence = source === 'pubmed' && paper.evidence ? EVIDENCE_STYLE[paper.evidence] : null;
                    return (
                        <article
                            key={paper.pmid ?? paper.arxivId ?? paper.url}
                            className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/60 px-3.5 py-3 dark:border-white/[0.06] dark:bg-white/[0.04] sm:px-4 sm:py-4"
                        >
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                {paper.retracted && (
                                    <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                        {tt.retracted}
                                    </span>
                                )}
                                {evidence && (
                                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${evidence.className}`}>
                                        {evidence.label[lang]}
                                    </span>
                                )}
                                {source === 'arxiv' && (
                                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${paper.published ? ARXIV_BADGE.published : ARXIV_BADGE.preprint}`}>
                                        {paper.published ? tt.peerReviewed : tt.preprint}
                                    </span>
                                )}
                                {source === 'arxiv' && paper.category && (
                                    <span className="rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-600 dark:bg-violet-400/10 dark:text-violet-200">
                                        {paper.category}
                                    </span>
                                )}
                                {paper.year && (
                                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                                        {paper.year}
                                    </span>
                                )}
                            </div>

                            <p className="break-words text-[14px] font-bold leading-snug text-slate-800 dark:text-slate-100">
                                {paper.title}
                            </p>

                            {(paper.journal || paper.authors?.length) && (
                                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                                    {[paper.journal, formatAuthors(paper.authors, tt.authorsMore)].filter(Boolean).join(' · ')}
                                </p>
                            )}

                            {paper.summary ? (
                                <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                                    {/* 결론 라벨이 붙은 초록만 '결론'이다. 나머지는 위치로 집은 추측이라
                                        그렇게 밝힌다 — 곁가지 문단이 결론인 척 읽히는 게 실제 결함이었다. */}
                                    {paper.summaryKind === 'excerpt' && (
                                        <span className="mr-1.5 rounded bg-slate-100 px-1 py-0.5 align-[1px] text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:bg-white/[0.06] dark:text-slate-500">
                                            {tt.excerpt}
                                        </span>
                                    )}
                                    {paper.summary}
                                </p>
                            ) : source === 'pubmed' ? (
                                <p className="mt-2 text-[13px] italic leading-relaxed text-slate-400 dark:text-slate-500">
                                    {tt.noAbstract}
                                </p>
                            ) : null}

                            
                            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                                <a
                                    href={paper.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-lg border border-violet-200/80 px-2 py-1 font-bold text-violet-700 hover:bg-violet-50 dark:border-violet-300/20 dark:text-violet-200 dark:hover:bg-violet-400/10"
                                >
                                    {source === 'arxiv' ? `arXiv:${paper.arxivId}` : `PMID ${paper.pmid}`}
                                </a>
                                {paper.doi && (
                                    <a
                                        href={`https://doi.org/${paper.doi}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="truncate text-slate-400 hover:text-violet-600 hover:underline dark:text-slate-500 dark:hover:text-violet-300"
                                    >
                                        doi {paper.doi}
                                    </a>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>

            {/*
              * 철회 논문 — 번호 없는 별도 칸.
              *
              * 🔴 목록에서 지우지 않고 여기로 내린 이유: 프롬프트로 "인용하지 말라" 고만 했을 때
              * 라이브 3회 중 2회가 그대로 근거로 인용했다. 인용 마커 [n] 은 `papers` 순번이므로
              * 도구가 배열에서 빼면 모델은 **번호로 가리킬 방법이 없다**. 그렇다고 화면에서까지
              * 지우면 사용자는 그 논문이 철회됐다는 걸 영영 모른다 — 그게 더 나쁘다.
              */}
            {retracted.length > 0 && (
                <div className="mt-3 rounded-2xl border border-red-200/70 bg-red-50/50 px-3.5 py-3 dark:border-red-400/20 dark:bg-red-500/[0.06] sm:px-4">
                    <p className="text-[12px] font-bold text-red-700 dark:text-red-300">
                        {tt.excludedTitle} · {retracted.length}{tt.found}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-red-600/90 dark:text-red-300/80">
                        {tt.excludedNote}
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                        {retracted.map(paper => (
                            <li key={paper.pmid ?? paper.url} className="text-[13px]">
                                <span className="mr-1.5 rounded-md bg-red-100 px-1.5 py-0.5 align-[1px] text-[11px] font-bold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                    {tt.retracted}
                                </span>
                                <span className="font-medium text-slate-600 line-through decoration-red-400/60 dark:text-slate-400">
                                    {paper.title}
                                </span>
                                <a
                                    href={paper.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1.5 whitespace-nowrap text-[11px] font-bold text-red-700 hover:underline dark:text-red-300"
                                >
                                    PMID {paper.pmid}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/*
              * 초록 없는 논문 — 번호 없는 별도 칸. 철회 칸과 **색도 문구도 다르다.**
              * 철회는 "믿지 마라", 이건 "우리가 요약을 못 한다" 다. 같은 상자에 담으면
              * 멀쩡한 논문에 철회의 색이 묻는다.
              *
              * 🔴 목록에서 빼낸 이유: `summary: ""` 를 그대로 보냈더니 모델이 그 공백을 연구
              * 내용으로 옮겨 적었다 — "일부 검토 논문 [1, 3] 에서는 구체적인 결론을 제시하지
              * 않았습니다". 전용 프롬프트 블록으로 3회 재측정해도 3회 모두 같았다.
              */}
            {noAbstract.length > 0 && (
                <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-3 dark:border-white/[0.06] dark:bg-white/[0.03] sm:px-4">
                    <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400">
                        {tt.noAbstractTitle} · {noAbstract.length}{tt.found}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                        {tt.noAbstractNote}
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                        {noAbstract.map(paper => (
                            <li key={paper.pmid ?? paper.url} className="text-[13px]">
                                <span className="font-medium text-slate-600 dark:text-slate-400">{paper.title}</span>
                                <a
                                    href={paper.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1.5 whitespace-nowrap text-[11px] font-bold text-violet-700 hover:underline dark:text-violet-300"
                                >
                                    PMID {paper.pmid}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
                    <button
                        type="button"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                    >
                        {tt.prev}
                    </button>
                    <p className="text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
                        {page + 1} / {totalPages}
                    </p>
                    <button
                        type="button"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                    >
                        {tt.next}
                    </button>
                </div>
            )}

            <p className="mt-2.5 flex items-start gap-2 px-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                <i className="fa-regular fa-circle-question mt-[2px] shrink-0" />
                <span>{tt.disclaimer[source]}</span>
            </p>
        </div>
    );
};
