import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildCardToolOutput } from "./card-tool-output";

/**
 * PubMed E-utilities 논문 조회 → `json:paper` 카드.
 *
 * 국립의과학지식센터(NCMIK) OpenAPI 를 먼저 검토했다가 폐기했다 — `kwd` 가 배선돼 있지 않아
 * 어떤 검색어를 줘도 같은 결과가 오고, `retstart` 가 1 외엔 빈 응답이며, 무엇보다 응답에
 * URL·DOI 가 없어 **인용 링크를 만들 수 없었다**(DEV_260830 §2).
 * PubMed 는 셋 다 준다. CrossRef 는 검색 품질이 떨어져 DOI 보강용으로만 남겨뒀다.
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const NCBI_KEY = process.env.NCBI_KEY || '';
const CONTACT = process.env.PAPER_API_CONTACT || '';

/** 무키 3 req/s, 키 10 req/s. 초과하면 429 가 실제로 떨어진다(실측). */
const MIN_GAP_MS = NCBI_KEY ? 110 : 350;
const CALL_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 8;

let lastCallAt = 0;

/**
 * E-utilities 호출 — 간격 제한 + 429 재시도.
 * per-call 타임아웃은 이 도구 전용 값이다. 다른 도구와 일률로 묶지 않는다
 * (25s 일률 적용이 YouTube 분석을 끊었던 전례가 있다).
 */
async function eutils(path: string, params: Record<string, string | number>): Promise<string> {
    const query = new URLSearchParams(
        Object.entries({ db: 'pubmed', tool: 'chat-agent', api_key: NCBI_KEY, email: CONTACT, ...params })
            .filter(([, v]) => v !== '' && v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
    );

    for (let attempt = 0; attempt < 3; attempt++) {
        const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
        if (wait) await new Promise(r => setTimeout(r, wait));
        lastCallAt = Date.now();

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
        try {
            const res = await fetch(`${EUTILS}/${path}?${query}`, { signal: controller.signal });
            if (res.status === 429) continue;              // 간격을 벌려 재시도
            if (!res.ok) throw new Error(`PubMed ${path} HTTP ${res.status}`);
            return await res.text();
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error('PubMed 요청이 레이트리밋(429)에 반복해서 막혔다');
}

export type EvidenceLevel = 'meta-analysis' | 'rct' | 'review';

/**
 * 🔴 `pubtype` 은 NLM 큐레이터가 **나중에** 붙인다. 최근 논문과 일부 저널 레코드에는 없어서
 * 제목에 "a meta-analysis" 라고 적힌 논문이 `['Journal Article']` 로만 오는 일이 흔하다.
 * 의학 질의 6종 240건 실측: pubtype 확정 64% · 미분류 35%.
 *
 * 제목으로 보조 판정하는 안은 240건 중 3건(1%)밖에 못 건져 **폐기**했다. 추측으로 등급을
 * 붙이는 대신 `null` 로 두고, 렌더러는 배지를 아예 그리지 않는다 — 미분류는 "등급이 낮다"가
 * 아니라 "아직 분류가 안 됐다"이므로 최하위처럼 보이는 표시를 달면 그게 거짓말이 된다.
 */
export const toEvidence = (pubtypes: string[]): EvidenceLevel | null => {
    if (pubtypes.includes('Meta-Analysis') || pubtypes.includes('Systematic Review')) return 'meta-analysis';
    if (pubtypes.includes('Randomized Controlled Trial')) return 'rct';
    if (pubtypes.includes('Review')) return 'review';
    return null;
};

/**
 * 🔴 철회된 논문인가. `pubtype` 에 이미 들어 있는 사실이라 추가 호출이 필요 없다.
 *
 * 실제로 철회된 메타분석(PMID 40323973)이 `종합분석` 배지를 달고 근거 카드에 떴다 —
 * 등급 배지가 신뢰 신호로 읽히는 자리에서 가장 나쁜 실패다. 미분류 배지를 안 그리기로 한 것과
 * 같은 원칙의 반대편이다: **모르는 건 그리지 않고, 아는 나쁜 사실은 반드시 그린다.**
 *
 * `Retracted Publication` 은 "이 논문이 철회됐다", `Retraction of Publication` 은
 * "이 글은 남의 철회 공고다" 로 뜻이 정반대다. 후자를 철회로 잡으면 정상 문헌을 깎게 된다.
 * `Expression of Concern` 은 철회가 아니라 편집자 우려 표명이므로 여기서 제외한다 —
 * 둘을 한 배지로 묶으면 아직 철회되지 않은 논문을 철회됐다고 말하는 셈이다.
 */
export const isRetracted = (pubtypes: string[]): boolean =>
    pubtypes.includes('Retracted Publication');

type Paper = {
    pmid: string;
    title: string;
    journal: string;
    year: string;
    authors: string[];
    evidence: EvidenceLevel | null;
    /** PubMed 가 철회로 표시한 논문 */
    retracted: boolean;
    doi: string | null;
    url: string;
    summary: string;
    /** 요약의 출처. 초록이 PubMed 에 없으면 `'none'`. */
    summaryKind: SummaryKind;
};

const decodeEntities = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, '&');

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/**
 * efetch XML 에서 PMID 별 결론 문장을 뽑는다.
 *
 * ⚖️ 이해상충(`<CoiStatement>`)은 **일부러 뽑지 않는다.** 태그 존재만으로는 판정이 안 되고
 * (대부분이 "이해상충 없음" 선언이다), 본문을 규칙으로 분류해보니 실제 CoiStatement 41건에서
 * 양방향 오분류가 20% 넘게 났다 — "has received research grant support" 를 없음으로,
 * "in the absence of any commercial relationships" 를 있음으로 잡는 식이다.
 * 저자의 재정적 편향을 표시하는 플래그가 5건 중 1건 틀리면 정직한 연구자를 깎거나
 * 후원 연구에 잘못된 안심을 준다. 필요하면 모델이 본문을 읽고 산문으로 언급하는 게 맞다.
 * 초록 형태가 두 가지다 — `<AbstractText Label="CONCLUSIONS">` 로 나뉜 것과 라벨 없는 통짜.
 * 전자는 결론 라벨만, 후자는 마지막 문장 몇 개를 쓴다.
 */
export type SummaryKind = 'conclusion' | 'excerpt' | 'none';

/**
 * 결론이 아닌 꼬리 문장 — 후속연구 권고, 등록번호, 자금 출처.
 * 통짜 초록에서 "마지막 두 문장"을 집으면 이것들이 그대로 딸려온다.
 */
const TAIL_BOILERPLATE = [
    /^(thus,?\s+|therefore,?\s+|however,?\s+)?(further|future|additional|more|larger|well[- ]designed)\s/i,
    /(trial|study|review)\s+(is|was)\s+registered|^registration[:\s]|prospero\s+(registration|crd)|clinicaltrials\.gov|^funding[:\s]|^protocol\s+registration/i,
    /^(copyright|©|\(c\))\s|all rights reserved|published by elsevier|this article is protected by copyright/i,
];

const isBoilerplate = (sentence: string) => TAIL_BOILERPLATE.some(re => re.test(sentence.trim()));

/** "In conclusion" 류 신호. 통짜 초록에서 결론이 어디서 시작하는지 알려주는 유일한 단서다. */
const CONCLUSION_CUE =
    /^(in conclusion|in summary|to summari[sz]e|we conclude|we therefore conclude|taken together|collectively|overall,|(our|these|the present)\s+(findings|results|data|study)\s+(suggest|indicate|show|demonstrate|support))/i;

const splitSentences = (text: string) => text.split(/(?<=\.)\s+/).map(t => t.trim()).filter(Boolean);

/**
 * efetch XML 에서 PMID 별 요약을 뽑는다.
 *
 * ⚖️ 이해상충(`<CoiStatement>`)은 **일부러 뽑지 않는다.** 태그 존재만으로는 판정이 안 되고
 * (대부분이 "이해상충 없음" 선언이다), 본문을 규칙으로 분류해보니 실제 CoiStatement 41건에서
 * 양방향 오분류가 20% 넘게 났다 — "has received research grant support" 를 없음으로,
 * "in the absence of any commercial relationships" 를 있음으로 잡는 식이다.
 * 저자의 재정적 편향을 표시하는 플래그가 5건 중 1건 틀리면 정직한 연구자를 깎거나
 * 후원 연구에 잘못된 안심을 준다. 필요하면 모델이 본문을 읽고 산문으로 언급하는 게 맞다.
 *
 * 🔴 **`kind` 를 함께 돌려주는 게 이 함수의 핵심이다.** 초록 형태는 두 가지인데
 * (`<AbstractText Label="CONCLUSIONS">` 로 나뉜 것과 라벨 없는 통짜) 앞의 것만 진짜 결론이고,
 * 뒤의 것은 **어디가 결론인지 알 수 없어 꼬리를 집는 추측**이다. 실제로 PMID 27055821 은
 * 1,933자짜리 통짜 초록의 마지막 두 문장이 "알칼리화·어싱에 대한 임상연구는 없었다" 라는
 * 곁가지였고, 프로바이오틱스 질의 카드에 그게 논문의 결론인 양 박혔다. 보일러플레이트를 걷고
 * 결론 신호를 찾도록 고쳤지만 그래도 추측은 추측이다 — 그래서 `'excerpt'` 로 표시해
 * 카드가 "결론"이라고 **말하지 않게** 한다. 못 고치는 건 숨기지 말고 이름을 붙인다.
 */
export function parseAbstracts(xml: string): Map<string, { text: string; kind: SummaryKind }> {
    const out = new Map<string, { text: string; kind: SummaryKind }>();
    for (const block of xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? []) {
        const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
        if (!pmid) continue;

        const labeled = [...block.matchAll(/<AbstractText\s+Label="([^"]*)"[^>]*>([\s\S]*?)<\/AbstractText>/g)];
        let text = '';
        // 🔴 초록이 아예 없는 논문이 실측 8% 다. 이때 `summary: ""` 만 보내면 모델이 그걸
        //   "이 논문은 결론을 제시하지 않았다" 라는 **연구 내용**으로 옮겨 적는다(라이브 실측).
        //   데이터 부재를 `'none'` 이라고 이름 붙여야 그 혼동이 끊긴다.
        let kind: SummaryKind = 'none';

        if (labeled.length) {
            const hit = labeled.find(m => /CONCLUSION|INTERPRETATION/i.test(m[1]));
            if (hit) {
                text = stripTags(hit[2]);
                kind = 'conclusion';
            } else {
                // 결론 라벨이 없는 구조화 초록 — 마지막 섹션은 결론이 아닐 수 있다.
                text = trimTail(stripTags(labeled[labeled.length - 1][2]));
                kind = 'excerpt';
            }
        } else {
            const plain = block.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/)?.[1];
            const full = plain ? stripTags(plain) : '';
            if (full) {
                text = pickExcerpt(full);
                kind = 'excerpt';
            }
        }

        out.set(pmid, { text: text.slice(0, 400), kind: text ? kind : 'none' });
    }
    return out;
}

/** 꼬리의 보일러플레이트 문장을 걷어낸다. 전부 보일러플레이트면 원본을 그대로 둔다. */
function trimTail(text: string): string {
    const sentences = splitSentences(text);
    while (sentences.length > 1 && isBoilerplate(sentences[sentences.length - 1])) sentences.pop();
    return sentences.length ? sentences.join(' ') : text;
}

/** 통짜 초록에서 결론으로 보이는 대목. 신호가 있으면 거기서부터, 없으면 마지막 두 문장. */
function pickExcerpt(text: string): string {
    const sentences = splitSentences(text);
    while (sentences.length > 1 && isBoilerplate(sentences[sentences.length - 1])) sentences.pop();

    for (let i = sentences.length - 1; i >= 0; i--) {
        if (CONCLUSION_CUE.test(sentences[i])) return sentences.slice(i).join(' ');
    }
    return sentences.slice(-2).join(' ');
}

/**
 * 검색어를 넓혀 다시 시도할 때 쓸 축약형 — 앞쪽 핵심어 4개만 남긴다.
 *
 * 🔴 **PubMed 는 용어를 AND 로 묶는다.** 모델이 검색어를 길게 잡으면 후보가 급격히 붕괴한다(실측):
 *   `probiotics common cold prevention` 54건 → 여기에 연구설계어까지 붙이면 **4건**
 *   `probiotics atopic dermatitis children` 398건 → 긴 형태 **1건**
 *   `stuttering speech therapy intervention` 865건 → 긴 형태 **1건**
 * 한 단어만 더 붙으면 0건이 되고, 그러면 수백 건이 있는데도 "논문을 찾지 못했습니다" 가 나간다.
 * **조용히 틀리는 쪽**이라 도구에서 막는다(프롬프트에도 짧게 쓰라는 지시를 넣었지만, 모델마다
 * 검색어 길이가 다르다 — gemini-3.7 은 3단어, gpt-5.6 은 12단어를 만들었다).
 */
/**
 * 주제 이탈 논문 걸러내기 — 질의의 **주제어**가 제목·초록에 없는 논문을 근거에서 뺀다.
 *
 * 🔴 실측(2026-09-01). `probiotics common cold prevention` 카드 5건 중 2건에 probiotics 가
 * 초록에 한 번도 안 나왔다 — 비타민C·에키네시아 리뷰와 "Earthing accelerates immune response"
 * 종설이 근거 자리에 올라왔다. 산문도 그 둘만 인용하지 않았다.
 *
 * 🔴 **용어 커버리지로는 못 가른다.** 실측 커버리지가 뒤집힌다(무관 75% vs 관련 50%).
 * "common cold prevention" 은 결과 전건이 공유하기 때문이다 — PubMed 가 그걸로 매칭했다.
 * 가르는 건 코퍼스에 **가장 적게 실린 용어** 하나뿐이다(probiotics 66,551 vs prevention 3,684,125).
 *
 * 🔴 **결과 내 빈도로 주제어를 고르는 공짜 방법은 실패했다** — 프로브 10질의 중 일치 1·불일치 6.
 * `elderly`·`outcomes`·`clinical` 을 골랐다. 그래서 esearch count 를 부른다(용어당 110ms,
 * 캐시됨). 측정 근거: `tests/manual/probe-paper-relevance.mts`.
 */

/** 관련도 판정에서 버리는 말. 이게 남으면 주제어 자리를 맥락어가 차지한다. */
const RELEVANCE_STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'for', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'is', 'are',
    'and', 'or', 'as', 'that', 'this', 'its', 'using', 'via', 'based', 'about', 'between',
]);

export const relevanceTerms = (query: string): string[] =>
    (query ?? '').toLowerCase().split(/[^a-z0-9-]+/)
        .filter(w => w.length > 2 && !RELEVANCE_STOPWORDS.has(w));

/**
 * 어미만 깎는다. 형태소 분석이 아니라 `probiotic`↔`probiotics`, `prevention`↔`preventing` 을
 * 잇기 위한 근사다.
 *
 * 🔴 **너무 깎으면 아무 데나 붙는다.** `lesion`→`les` 는 "unless"·"lesser" 에 걸리고
 * `series`→`ser` 는 "serum"·"observer" 에 걸린다 — 주제어가 사실상 무력화된다. 그래서 깎은
 * 결과가 4자 미만이면 원형을 쓴다(그런 짧은 어간은 판별력이 없다).
 */
const stemTerm = (w: string) => {
    const cut = w.replace(/(ings?|ion|ies|es|s)$/, '');
    return cut.length >= 4 ? cut : w;
};
const mentions = (haystack: string, term: string) => haystack.includes(stemTerm(term));

/**
 * 코퍼스 수록량이 가장 적은 용어 = 주제어.
 * 0건은 후보에서 뺀다(오타·비표준어). 판별할 용어가 2개 미만이면 주제어가 없다 —
 * 하나뿐인 용어로 거르면 그건 관련도가 아니라 그냥 그 단어의 유무다.
 */
export const pickHeadTerm = (counts: Map<string, number>): string | null => {
    const known = [...counts.entries()].filter(([, n]) => n > 0);
    if (known.length < 2) return null;
    return known.sort((a, b) => a[1] - b[1])[0][0];
};

/**
 * 주제어 유무로 가른다. **fail-open** 이 두 군데 있다:
 *   - 주제어가 없으면(판별 불가) 아무것도 거르지 않는다
 *   - 주제어가 결과의 **절반 미만**에만 있으면 거르지 않는다 — 그건 개별 논문이 어긋난 게 아니라
 *     질의 자체가 코퍼스와 어긋난 것이다. 여기서 걸러 버리면 카드가 통째로 빈다.
 *     (프로브 10질의에서 한 번도 발동하지 않았다. 최저가 3/5 였다.)
 */
/**
 * 인용 가능한 논문과 그렇지 않은 것을 가른다.
 *
 * 🔴 프롬프트로 "철회 논문을 인용하지 말라" 고 시켜봤지만 라이브 3회 중 2회가 그냥 인용했다
 * (철회된 메타분석을 "한 메타분석에 따르면" 으로). 초록이 없는 논문(실측 8%)은 더 나빴다 —
 * 모델이 그 공백을 **연구 내용으로** 옮겨 적었다("결론을 제시하지 않았습니다"). 둘 다 도구가
 * 배열에서 빼낸다: 인용 마커 [n] 이 `papers` 순번이라 빠지면 가리킬 수가 없다.
 *
 * ⚖️ 두 칸을 합치지 않는다. 철회는 "믿지 마라", 초록 없음은 "우리가 요약을 못 한다" 로 뜻이
 * 다르다. 한 상자에 담으면 멀쩡한 논문에 철회의 색이 묻는다.
 */
export function partitionPapers<T extends { retracted: boolean; summaryKind: SummaryKind }>(
    papers: T[],
): { citable: T[]; retracted: T[]; noAbstract: T[] } {
    return {
        citable: papers.filter(p => !p.retracted && p.summaryKind !== 'none'),
        retracted: papers.filter(p => p.retracted),
        noAbstract: papers.filter(p => !p.retracted && p.summaryKind === 'none'),
    };
}

export function splitOffTopic<T extends { title: string; summary: string }>(
    papers: T[], headTerm: string | null,
): { kept: T[]; offTopic: T[]; applied: boolean } {
    if (!headTerm || !papers.length) return { kept: papers, offTopic: [], applied: false };
    const onTopic = (p: T) => mentions(`${p.title} ${p.summary}`.toLowerCase(), headTerm);
    const hits = papers.filter(onTopic);
    if (hits.length * 2 < papers.length) return { kept: papers, offTopic: [], applied: false };
    return { kept: hits, offTopic: papers.filter(p => !onTopic(p)), applied: true };
}

/**
 * 곁칸(철회·초록없음)에서 주제 무관한 것을 뺀다.
 *
 * 🔴 실측(2026-09-01): 감기 논문을 물었는데 **철회됨** 딱지가 붙은 위장 논문
 * (`Alternative Treatments for Minor GI Ailments`)이 카드에 떴다. 주제 필터가 `papers` 에만
 * 걸려 있었다. 모델이 인용할 수는 없으니 사실 오류는 아니지만, 질문과 무관한 경고는 잡음이다.
 *
 * ⚖️ **초록이 없는 논문은 판단하지 않는다.** `summary` 가 빈 문자열이라 제목만 남는데, 실측 3건 중
 * `Prevention and treatment of the common cold: making sense of the evidence` 는 제목에
 * probiotics 가 없어도 질문과 관련 있는 논문이다. 근거가 없으면 판단하지 않는 편이 낫다.
 *
 * ⚖️ `splitOffTopic` 을 그대로 쓰지 않는다. 곁칸은 보통 1~2건이라 "절반 미만이면 fail-open"
 * 규칙이 **항상** 발동해 아무것도 안 걸러진다. 주제어의 타당성은 본 목록에서 이미 검증됐으므로
 * (`applied === true` 일 때만 호출한다) 여기서는 건별로 본다.
 */
export function filterOffTopicAside<T extends { title: string; summary: string; summaryKind: SummaryKind }>(
    papers: T[], headTerm: string | null,
): T[] {
    if (!headTerm) return papers;
    return papers.filter(p => p.summaryKind === 'none'
        || mentions(`${p.title} ${p.summary}`.toLowerCase(), headTerm));
}

export const broadenQuery = (query: string): string =>
    query.trim().split(/\s+/).slice(0, 4).join(' ');

/**
 * 용어별 PubMed 수록량. **모듈 수준 캐시** — `prevention`·`trial`·`randomized` 같은 맥락어는
 * 질의마다 되풀이되므로 두 번째부터 공짜다. 실패하면 0 을 돌려 후보에서 빠지게 한다:
 * 관련도 필터 때문에 논문 검색 자체가 죽으면 안 된다.
 */
const termTotals = new Map<string, number>();
async function pubmedTermTotal(term: string): Promise<number> {
    const cached = termTotals.get(term);
    if (cached !== undefined) return cached;
    try {
        const json = JSON.parse(await eutils('esearch.fcgi', { term, rettype: 'count', retmode: 'json' }));
        const n = Number(json?.esearchresult?.count ?? 0);
        termTotals.set(term, n);
        return n;
    } catch {
        termTotals.set(term, 0);
        return 0;
    }
}

async function searchPapers(query: string, limit: number): Promise<{
    total: number; papers: Paper[]; retracted: Paper[]; noAbstract: Paper[];
}> {
    /**
     * 요청한 수보다 조금 더 받아온다. 철회·초록없음 논문이 번호 목록에서 빠지므로 (실측:
     * 프로바이오틱스 질의는 5건 중 2건이 초록 없음) 정확히 limit 만 받으면 근거 목록이 얇아진다.
     */
    const retmax = Math.min(limit + 3, MAX_RESULTS);
    const run = async (term: string) => JSON.parse(await eutils('esearch.fcgi', {
        term, retmax, retmode: 'json', sort: 'relevance',
    }));

    let searchJson = await run(query);
    let ids: string[] = searchJson?.esearchresult?.idlist ?? [];
    let total = Number(searchJson?.esearchresult?.count ?? 0);

    // 0건이면 한 번만 넓혀서 재시도한다. 넓힌 검색어가 원본과 같으면(이미 짧으면) 그대로 0건이다.
    if (!ids.length) {
        const broader = broadenQuery(query);
        if (broader && broader !== query.trim()) {
            console.log(`[paperTool] 0건 → 검색어를 넓혀 재시도: "${query}" → "${broader}"`);
            searchJson = await run(broader);
            ids = searchJson?.esearchresult?.idlist ?? [];
            total = Number(searchJson?.esearchresult?.count ?? 0);
        }
    }
    if (!ids.length) return { total, papers: [], retracted: [], noAbstract: [] };

    const [summaryText, abstractXml] = await Promise.all([
        eutils('esummary.fcgi', { id: ids.join(','), retmode: 'json' }),
        eutils('efetch.fcgi', { id: ids.join(','), retmode: 'xml' }),
    ]);

    const result = JSON.parse(summaryText)?.result;
    if (!result) throw new Error('PubMed esummary 응답에 result 가 없다');
    const abstracts = parseAbstracts(abstractXml);

    const papers = ids.flatMap((id): Paper[] => {
        const r = result[id];
        if (!r) return [];
        return [{
            pmid: id,
            // esummary 의 title 에는 <i>·<sup> 같은 태그가 그대로 들어온다
            title: stripTags(String(r.title ?? '')).replace(/\.$/, ''),
            journal: r.fulljournalname ?? r.source ?? '',
            year: String(r.pubdate ?? '').slice(0, 4),
            authors: (r.authors ?? []).map((a: { name: string }) => a.name).filter(Boolean),
            evidence: toEvidence(r.pubtype ?? []),
            retracted: isRetracted(r.pubtype ?? []),
            doi: r.articleids?.find((a: { idtype: string }) => a.idtype === 'doi')?.value ?? null,
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
            summary: abstracts.get(id)?.text ?? '',
            summaryKind: abstracts.get(id)?.kind ?? 'none',
        }];
    });

    /**
     * 🔴 인용할 수 없는 논문은 **번호 매기는 목록에서 빼낸다.** 두 종류다.
     *
     * 1. 철회된 논문 — 프롬프트로 "인용하지 말라" 고 시켜봤지만 라이브 3회 중 2회가 그냥
     *    근거로 인용했다(철회된 메타분석을 "한 메타분석에 따르면" 으로).
     * 2. 초록이 아예 없는 논문(실측 8%) — `summary: ""` 를 보냈더니 모델이 그 공백을
     *    **연구 내용으로 옮겨 적었다**: "일부 검토 논문 [1, 3] 에서는 구체적인 결론을 제시하지
     *    않았습니다". PubMed 에 초록이 없다는 뜻일 뿐인데 논문이 결론을 안 냈다는 거짓이 된다.
     *    전용 프롬프트 블록으로 3회 재측정했지만 3회 모두 그대로였다.
     *
     * 인용 마커 [n] 은 `papers` 배열의 순번이므로, 여기서 빼면 **모델이 번호로 가리킬 수가 없다** —
     * 카드를 모델에게 다시 쓰게 하지 않고 코드가 붙이기로 한 것과 같은 판단이다.
     * 다만 화면에서 지우지는 않는다. 둘 다 사용자에게는 쓸모가 있다(철회 사실을 아는 것,
     * 초록 없는 논문의 원문을 여는 것) — 그래서 번호 없는 별도 칸으로 따로 내려보낸다.
     *
     * ⚖️ 두 칸을 하나로 합치지 않는다. 철회는 "믿지 마라", 초록 없음은 "우리가 요약을 못 한다" 로
     * 뜻이 전혀 다르다. 한 상자에 담으면 멀쩡한 논문에 철회의 색이 묻는다.
     */
    /**
     * 주제 이탈 제거는 철회·초록없음을 걸러낸 **뒤**, limit 로 자르기 **전**에 한다.
     * 그래야 retmax(limit+3) 로 더 받아둔 여유분이 자동으로 자리를 메운다 — 카드는 그대로 5건이다.
     */
    const { citable, retracted, noAbstract } = partitionPapers(papers);
    const terms = relevanceTerms(query);
    let onTopic = citable;
    // 곁칸(철회)에도 같은 주제어를 쓰려면 본 목록에서 필터가 실제로 걸렸는지 알아야 한다
    let appliedHead: string | null = null;
    if (terms.length >= 2 && citable.length) {
        const counts = new Map<string, number>();
        for (const t of terms) counts.set(t, await pubmedTermTotal(t));
        const head = pickHeadTerm(counts);
        const split = splitOffTopic(citable, head);
        if (split.offTopic.length) {
            console.log(`[paperTool] 주제어 "${head}" 없는 논문 ${split.offTopic.length}건 제외: ` +
                split.offTopic.map(p => p.pmid).join(', '));
        }
        onTopic = split.kept;
        if (split.applied) appliedHead = head;
    }

    return {
        total,
        papers: onTopic.slice(0, limit),
        retracted: filterOffTopicAside(retracted, appliedHead),
        noAbstract,
    };
}

export const paperTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
        const term = query?.trim();
        if (!term) return buildCardToolOutput('paper', { query: '', source: 'pubmed', total: 0, papers: [], retracted: [], noAbstract: [] });

        try {
            const { total, papers, retracted, noAbstract } = await searchPapers(term, limit ?? 5);
            /**
             * 0건이어도 카드는 만든다 — 렌더러가 "찾지 못했습니다" 상태를 그린다.
             * ⚖️ 예전 주석은 "0건이면 카드를 안 띄운다" 였는데 **코드가 그러지 않았다.**
             * 실제로 안 띄우려면 도구가 카드 없는 평문을 돌려줘야 하는데, 그러면
             * `pinCardToProse` 가 호출되지 않아 **모델이 지어낸 카드가 그대로 통과한다**
             * (`toolMsg` 를 카드 문자열로 찾기 때문). 지어낸 논문이 나가는 쪽이 훨씬 나쁘다.
             */
            return buildCardToolOutput('paper', { query: term, source: 'pubmed', total, papers, retracted, noAbstract });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[paperTool]', message);
            return buildCardToolOutput('paper', { query: term, source: 'pubmed', total: 0, papers: [], retracted: [], noAbstract: [], error: message });
        }
    },
    {
        name: "search_papers",
        description:
            "PubMed 에서 의학·생명과학 논문을 검색해 제목·저널·연도·저자·DOI·인용 URL 과 초록 결론을 반환한다. " +
            "근거가 필요한 의학 질문에 사용한다. 인용 번호 [n] 은 `papers` 의 순번이며, 인용할 수 없는 논문은 " +
            "`papers` 에서 빠져 `retracted`(철회) · `noAbstract`(PubMed 에 초록 없음) 로 분리돼 나온다.",
        schema: z.object({
            query: z.string().describe("PubMed 검색어. 한국어 질문이라도 의학 용어는 영어로 변환해서 넣는다."),
            limit: z.number().optional().describe(`반환할 논문 수 (기본 5, 최대 ${MAX_RESULTS})`),
        }),
    },
);
