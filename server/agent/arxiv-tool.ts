import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildCardToolOutput } from "./card-tool-output";

/**
 * arXiv API 논문 조회 → `json:paper` 카드(`source: 'arxiv'`).
 *
 * PubMed 가 못 덮는 비의생명 분야(강화학습·로봇제어·통화정책·반도체·내진설계 등)를 맡는다 → DEV_260830 §6.5
 *
 * 나머지는 메우지 못한다. arXiv 도 빈손으로 실패하지 않고 무관한 논문을 돌려준다
 * (예: "한국어 통사론" → 전파망원경 논문). 문학·예술사·역사·법학·고고학·정치학은 어느 쪽에도 없으므로
 * 라우터 판정은 3분기다(pubmed / arxiv / none) — `none` 은 카드 없이 산문으로 답한다.
 *
 * arXiv 는 프리프린트다. 동료심사를 거치지 않은 글이 섞여 있으므로 PubMed 의 근거 등급
 * 배지(종합분석·임상시험·논문리뷰)를 쓰지 않는다. `journal_ref`/`doi` 가 있으면
 * 저널 판본이 있다는 뜻이라 "게재됨", 없으면 "프리프린트"로 **심사 여부만** 밝힌다.
 */

const ARXIV_API = 'https://export.arxiv.org/api/query';

/** arXiv 는 요청 간 3초를 권고한다(문서 명시). 지키지 않으면 임시 차단된다. */
const MIN_GAP_MS = 3_000;
/** 검색 API 응답이 PubMed 보다 느리다(2~6초). per-call 값은 이 도구 전용이다. */
const CALL_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

let lastCallAt = 0;

/**
 * 질의 → arXiv `search_query`.
 *
 * `all:a b c` 는 세 단어를 **OR** 로 묶어 한 단어만 맞은 무관 논문이 상위에 오른다
 * (예: "transformer attention optimization" 에 다항식 최적화 논문). AND 로 묶으면 상위가 전부 관련 논문이다.
 *
 * 따옴표 구절 조회는 진짜 구절(논문 제목)일 때만 걸린다 — `all:"Attention Is All You Need"` 는
 * 원 논문을 찾는다. 그래서 `buildArxivQueryPlan` 의 1순위로 둔다 → DEV_260831·DEV_260903
 */
const ARXIV_FIELD = /\b(?:ti|au|abs|cat|jr|all|co|rn|id):/;
const ARXIV_BOOL = /\b(?:AND|OR|ANDNOT)\b/;
/** arXiv 는 기능어를 색인하지 않는다 — AND 에 끼우면 결과가 통째로 0이 된다. */
const STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'for', 'in', 'on', 'at', 'to', 'by', 'with', 'from',
    'is', 'are', 'be', 'and', 'or', 'as', 'all', 'that', 'this', 'it', 'its', 'you', 'we',
    'using', 'via', 'based', 'about',
]);

export const buildArxivSearchQuery = (query: string): string => {
    const term = (query ?? '').trim().replace(/\s+/g, ' ');
    if (!term) return 'all:';
    // 이미 arXiv 문법이면 손대지 않는다 — 한 번 더 감싸면 all:all: 이 된다
    if (ARXIV_FIELD.test(term) || ARXIV_BOOL.test(term)) return term;
    if (/["()]/.test(term)) return `all:${term}`;

    const words = term.split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w.toLowerCase()));
    if (words.length < 2) return `all:${words[0] ?? term}`;
    return words.map(w => `all:${w}`).join(' AND ');
};

/**
 * 조회 계획 — 앞에서부터 시도하고 **결과가 나오는 첫 항목**을 쓴다.
 *
 * 제목처럼 불용어가 섞인 질의는 불용어가 버려지면 AND 조립이 원 논문을 놓친다
 * (`Attention Is All You Need` → `all:Attention AND all:Need`). 평범한 검색어에는 불용어가 없고
 * 제목·구절에는 있으므로, 불용어가 섞였을 때만 구절(`all:"…"`)을 먼저 치고 0건이면 AND 조립으로 내려온다.
 *
 * 주의: 한 번의 호출로 합치는 `all:"…" OR (all:a AND all:b)` 는 안 된다 — 관련도 정렬이 구절 일치를
 * 우대하지 않는다. 그래서 순차 폴백이고, arXiv 간격 규칙(`MIN_GAP_MS`) 때문에 불용어가 있는 질의로만 좁힌다 → DEV_260903
 */
export const buildArxivQueryPlan = (query: string): string[] => {
    const term = (query ?? '').trim().replace(/\s+/g, ' ');
    const and = buildArxivSearchQuery(term);
    if (!term) return [and];
    if (ARXIV_FIELD.test(term) || ARXIV_BOOL.test(term) || /["()]/.test(term)) return [and];

    const words = term.split(' ');
    const kept = words.filter(w => w.length > 1 && !STOPWORDS.has(w.toLowerCase()));
    // 3단어 미만은 구절이라 부를 게 못 된다(`based on` 같은 조각이 걸린다).
    if (words.length < 3 || kept.length === words.length) return [and];
    // `ti:` 가 먼저다 — 제목을 물었으면 제목 필드를 본다. `all:"…"` 에서는 비슷한 제목의 다른 논문이
    // 1위가 될 수 있고, 모델이 `limit:1` 로 부르면 카드에 남는 1위 하나를 산문이 답으로 설명한다.
    // `all:"<구절>"` 을 가운데 두는 3단 계획은 쓰지 않는다 — `ti:` 가 0건이면 `all:"…"` 도 0건이었고
    // 최악 지연만 늘린다 → DEV_260903
    return [`ti:"${term}"`, and];
};

async function fetchArxiv(searchQuery: string, limit: number): Promise<string> {
    const params = new URLSearchParams({
        search_query: searchQuery,
        start: '0',
        max_results: String(Math.min(limit, MAX_RESULTS)),
        sortBy: 'relevance',
        sortOrder: 'descending',
    });

    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastCallAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
        const res = await fetch(`${ARXIV_API}?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

const ENTITIES: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
};
export const unescapeXml = (s: string): string =>
    s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, m => ENTITIES[m] ?? m);

/** 태그 하나의 텍스트. 없으면 빈 문자열 — 필드 누락은 arXiv 에서 흔하다. */
const tag = (xml: string, name: string): string => {
    const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? unescapeXml(m[1].replace(/\s+/g, ' ').trim()) : '';
};

interface ArxivPaper {
    arxivId: string;
    title: string;
    authors: string[];
    year: string;
    category: string;
    journal: string;
    doi: string | null;
    /** 저널 게재 판본이 확인되는가 — 배지가 "게재됨"/"프리프린트"를 가르는 유일한 근거다. */
    published: boolean;
    url: string;
    summary: string;
}

/**
 * Atom 응답 → 카드 데이터.
 *
 * 초록은 PubMed 와 달리 구조화돼 있지 않다(결론 라벨이 없다). 앞 2문장이 arXiv 초록에서는
 * 사실상 주제문이라 그대로 쓴다 — 뒤 2문장을 쓰는 PubMed 규칙을 그대로 옮기면 실험 세부만 남는다.
 */
export function parseArxivFeed(xml: string): { total: number; papers: ArxivPaper[] } {
    const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
    const total = totalMatch ? Number(totalMatch[1]) : 0;

    const papers: ArxivPaper[] = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const entry = m[1];
        const idUrl = tag(entry, 'id');
        // http://arxiv.org/abs/2401.12345v2 → 2401.12345 (버전 접미사는 뺀다 — 링크는 최신판으로)
        const arxivId = (idUrl.match(/abs\/(.+?)(?:v\d+)?$/)?.[1] ?? '').trim();
        if (!arxivId) continue;

        const abstract = tag(entry, 'summary');
        const sentences = abstract.split(/(?<=\.)\s+/);
        const journal = tag(entry, 'arxiv:journal_ref');
        const doi = tag(entry, 'arxiv:doi') || null;

        papers.push({
            arxivId,
            title: tag(entry, 'title'),
            authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
                .map(a => unescapeXml(a[1].trim())).filter(Boolean),
            year: tag(entry, 'published').slice(0, 4),
            category: entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? '',
            journal,
            doi,
            published: !!(journal || doi),
            url: `https://arxiv.org/abs/${arxivId}`,
            summary: sentences.slice(0, 2).join(' ').slice(0, 400),
        });
    }
    return { total, papers };
}

/**
 * `query` 파라미터 설명 — **두 공급자 경로가 이 한 문장을 공유한다.**
 *
 * 검색어는 AND 로 묶이므로 덧붙인 범용어("neural network" 등)가 교집합 순위를 자기 쪽으로 끌어당긴다
 * (`트랜스포머 논문` 에 `transformer neural network` 를 보내면 원 논문이 빠진다).
 * 코드로 범용어를 거르면 `graph neural network` 처럼 그게 복합 개념의 일부인 질의를 무너뜨린다 —
 * 가르는 건 문맥이고 문맥은 모델만 알므로 도구 설명에서 막는다.
 *
 * 상수로 두는 이유: LangChain 스키마와 OpenAI 레지스트리(`local-tool-registry.ts`)가 각자 사본을 가지면
 * 한쪽만 고쳐진다 → DEV_260903
 */
export const ARXIV_QUERY_DESCRIPTION =
    "arXiv 검색어. 한국어 질문이라도 학술 용어는 영어로 변환해서 넣는다. " +
    "사용자가 말한 주제어만 넣는다 — 말하지 않은 범용어(neural network, model, deep learning, " +
    "method, system, architecture 등)를 덧붙이지 않는다. '트랜스포머 논문' 은 `transformer` 이지 " +
    "`transformer neural network` 가 아니다. 논문 제목을 물으면 **제목만** 넣는다 — " +
    "'Attention Is All You Need' 이지 'Attention Is All You Need Transformer architecture' 가 아니다. " +
    "다만 'graph neural network'·'convolutional neural network' 처럼 그 자체가 하나의 개념이면 통째로 넣는다.";

export const arxivTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
        const term = query?.trim();
        if (!term) return buildCardToolOutput('paper', { query: '', source: 'arxiv', total: 0, papers: [] });

        try {
            // 0건이면 0건이다 — OR 로 넓히지 않는다. arXiv 에 없는 분야는 AND 0건이 정답이고,
            // OR 로 넓히면 단어 하나만 걸린 논문(무의미어면 수만 건)이 근거로 올라온다. 빈손으로 실패하는 편이 낫다.
            // 계획을 앞에서부터 시도하고 **결과가 나오는 첫 항목**을 쓴다. 마지막 항목까지 0건이면 그 0건이 답이다.
            const plan = buildArxivQueryPlan(term);
            let result = { total: 0, papers: [] as ArxivPaper[] };
            for (const searchQuery of plan) {
                result = parseArxivFeed(await fetchArxiv(searchQuery, limit ?? 5));
                if (result.papers.length > 0) {
                    if (searchQuery !== plan[plan.length - 1]) console.log(`[arxivTool] 구절 조회 적중: ${searchQuery} (${result.total}건)`);
                    break;
                }
            }
            const { total, papers } = result;
            return buildCardToolOutput('paper', { query: term, source: 'arxiv', total, papers });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[arxivTool]', message);
            return buildCardToolOutput('paper', { query: term, source: 'arxiv', total: 0, papers: [], error: message });
        }
    },
    {
        name: "search_arxiv",
        description:
            "arXiv 에서 물리·수학·전산·통계·공학·계량경제 분야의 프리프린트/논문을 검색해 " +
            "제목·저자·연도·분류·arXiv ID·인용 URL 과 초록 요약을 반환한다. " +
            "의생명 주제에는 쓰지 않는다(그쪽은 search_papers).",
        schema: z.object({
            query: z.string().describe(ARXIV_QUERY_DESCRIPTION),
            limit: z.number().optional().describe(`반환할 논문 수 (기본 5, 최대 ${MAX_RESULTS})`),
        }),
    },
);
