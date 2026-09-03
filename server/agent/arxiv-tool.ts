import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildCardToolOutput } from "./card-tool-output";

/**
 * arXiv API 논문 조회 → `json:paper` 카드(`source: 'arxiv'`).
 *
 * PubMed 를 붙이고 나니 비의생명 논문 요청이 전부 `general` 로 떨어져 근거 없이 답하고 있었다.
 * arXiv 는 그 공백의 절반을 정확히 메운다 — 실측(2026-08-30): 강화학습·로봇제어·통화정책·
 * 반도체·내진설계 질의에서 전부 해당 분야 논문이 1위로 나왔다(DEV_260830 §6.5).
 *
 * 🔴 **나머지 절반은 메우지 못한다.** arXiv 도 PubMed 처럼 빈손으로 실패하지 않는다:
 *   "한국어 통사론" → `astro-ph` **Korean VLBI Network**(전파망원경) 770,886건
 *   "조선시대 신분제" → `cs.SI` 소셜 추천시스템 · "인상주의 회화" → `cs.CV` Neural Painting
 * 문학·예술사·역사·법학·고고학·정치학은 **어느 쪽에도 없다.** 그래서 라우터의 판정은
 * 2분기가 아니라 3분기다(pubmed / arxiv / none) — `none` 은 카드 없이 산문으로 답한다.
 *
 * 🔴 **arXiv 는 프리프린트다.** 동료심사를 거치지 않은 글이 섞여 있으므로 PubMed 의 근거 등급
 * 배지(종합분석·임상시험·논문리뷰)를 그대로 쓰면 안 된다. `journal_ref`/`doi` 가 있으면
 * 저널에 실린 판본이 있다는 뜻이라 "게재됨", 없으면 "프리프린트"로 **심사 여부만** 밝힌다.
 */

const ARXIV_API = 'https://export.arxiv.org/api/query';

/** arXiv 는 요청 간 3초를 권고한다(문서 명시). 지키지 않으면 임시 차단된다. */
const MIN_GAP_MS = 3_000;
/** 검색 API 응답이 PubMed 보다 느리다 — 실측 2~6초. per-call 값은 이 도구 전용이다. */
const CALL_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

let lastCallAt = 0;

/**
 * 질의 → arXiv `search_query`.
 *
 * 🔴 `all:transformer attention optimization` 은 세 단어를 **OR** 로 묶는다. 실측(2026-08-31):
 * 576,986건이 걸리고 상위 5건 중 2건이 "optimization" 하나만 맞은 무관 논문이었다
 * (다항식 최적화·프레임 구조 설계가 트랜스포머 질문의 근거 카드에 올라왔다).
 * AND 로 묶으면 2,776건에 상위 5건 전부 관련이다. `bridge seismic design` 은 더 심하다 —
 * OR 상위 3건에 교량 논문이 아예 없고, AND 10건은 전부 교량이다.
 *
 * ⚖️ **"따옴표는 0건이라 못 쓴다"고 적었던 건 과일반화였다**(2026-09-03 정정).
 * `all:"transformer attention optimization"` 이 0건인 건 **그게 진짜 구절이 아니어서**다.
 * 진짜 구절 — 논문 제목 — 은 걸린다: `all:"Attention Is All You Need"` 45건, 원 논문 2위.
 * 그래서 구절 조회를 폐기하지 않고 `buildArxivQueryPlan` 의 1순위로 남겼다.
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
 * 🔴 실측(2026-09-03): `Attention Is All You Need` 는 다섯 단어 중 `is`·`all`·`you` 가
 * 불용어라 `all:Attention AND all:Need`(7,982건) 로 줄고, **원 논문 1706.03762 가 상위 5건에
 * 들지 못한다.** 제목을 그대로 물었는데 그 제목의 논문이 안 나온다.
 *
 * 가르는 신호는 **버려지는 불용어의 존재**다. 평범한 검색어(`graph neural network`,
 * `probiotics depression`, `bridge seismic design`)에는 불용어가 하나도 없고, 제목·구절에는 있다.
 * 그래서 불용어가 섞였을 때만 구절(`all:"…"`)을 먼저 치고, 0건이면 기존 AND 조립으로 내려온다.
 *
 * ⚠️ 한 번의 호출로 합치는 `all:"…" OR (all:a AND all:b)` 는 **안 된다** — 실측상 관련도 정렬이
 * 구절 일치를 우대하지 않아 원 논문이 여전히 상위 5건 밖이었다. 그래서 순차 폴백이다.
 * 폴백은 arXiv 간격 규칙(`MIN_GAP_MS`) 때문에 공짜가 아니라, 불용어가 있는 질의로 범위를 좁혔다.
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
    // 🔴 `ti:` 가 먼저다. 실측(2026-09-03): `Attention Is All You Need` 는
    //   `all:"…"` 에서 **2위**(1위는 2026년 `Tool Attention Is All You Need`)인데
    //   `ti:"…"` 에서는 **1위**다. 그 한 칸이 화면을 가른다 — 모델이 `limit:1` 로 부르면
    //   카드에 남는 건 1위 하나뿐이고, 산문이 **엉뚱한 논문을 답으로 설명한다**(실측).
    //   제목을 물었으면 제목 필드를 본다.
    // ⚖️ `all:"<구절>"` 을 가운데에 두는 3단 계획도 만들어 봤다가 뺐다 — 구절 6종 실측에서
    //   **`ti:` 가 0이면 `all:"…"` 도 예외 없이 0이었다**(35/45 · 2/3 · 0/0 · 47/214 · 12/13 ·
    //   129/741). 단독으로 건진 경우가 없는데 최악 지연만 3초에서 6초로 늘린다.
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

export interface ArxivPaper {
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
 * 🔴 실측(2026-09-03): `트랜스포머 논문 찾아줘` 에 모델이 `transformer neural network` 를 보냈고,
 * 상위 5건 중 관련 1건짜리 카드가 나갔다(원 논문 없음, 베이즈 필터·음향 인식이 올라옴).
 * `transformer` 만 보냈으면 5/5 였다. 검색어는 AND 로 묶이므로 덧붙인 범용어가 교집합의
 * 순위를 자기 쪽으로 끌어당긴다.
 *
 * ⚠️ 코드로 범용어를 걸러내 봤지만 되돌렸다 — `graph neural network` 처럼 그게 복합 개념의
 * 일부인 질의를 무너뜨린다. 가르는 건 문맥이고 문맥은 모델만 안다. 그래서 **여기서** 막는다.
 *
 * 🔴 **상수로 뺀 이유가 결함이다.** 같은 지시를 LangChain 스키마에만 넣었더니 OpenAI 경로는
 * `local-tool-registry.ts` 에 **자기 사본**을 갖고 있어 고쳐지지 않았고, gpt-5.6-luna 가
 * `Attention Is All You Need Transformer architecture self-attention` 으로 조회해 원 논문 없는
 * 카드를 냈다(2026-09-03 재현). 두 벌을 두면 한쪽만 고친다.
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
            // 🔴 0건이면 0건이다 — OR 로 넓히지 않는다. 실측: `sourdough fermentation microbiome
            // kinetics` 는 AND 0건인데 이게 정답이다(arXiv 에 없는 분야). OR 로 넓히면
            // "kinetics" 하나만 걸린 논문이 근거로 올라온다. 무의미어(`zzqqxx nonexistent topic`)
            // 는 더 심해서 35,416건의 토픽모델링 논문을 물어 온다. 빈손으로 실패하는 편이 낫다.
            // 계획을 앞에서부터 시도하고 **결과가 나오는 첫 항목**을 쓴다. 마지막 항목까지 0건이면
            // 그 0건이 답이다(위 주석 — OR 로 넓히지 않는다).
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
