import { tool } from "@langchain/core/tools";
import { z } from "zod";

const LAW_BASE_URL = "https://www.law.go.kr/DRF";
const FETCH_TIMEOUT_MS = 15000;
const FETCH_MAX_ATTEMPTS = 3;

type LawSearchItem = Record<string, any>;
type NormalizedClause = {
    number: string;
    text: string;
    subItems?: { number: string; text: string }[];
};

const asArray = <T>(value: T | T[] | undefined | null): T[] => [value].flat().filter(Boolean) as T[];

function getLawOc(): string {
    return process.env.LAW_OC || "";
}

const STOP_WORDS = new Set([
    "관련", "대해", "대한", "정리", "알려줘", "설명", "내용", "조항", "법령", "법률",
    "처벌", "기준", "어떻게", "무엇", "있나요", "궁금", "위반",
]);

function formatDate(value?: string): string {
    if (!value || value.length !== 8) return value || "";
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function toArticleCode(articleNo?: string): string | undefined {
    if (!articleNo) return undefined;
    const match = articleNo.match(/(\d+)(?:\s*의\s*(\d+))?/);
    if (!match) return undefined;
    const base = match[1].padStart(4, "0");
    const branch = (match[2] || "0").padStart(2, "0");
    return `${base}${branch}`;
}

function getDepartmentName(value: any): string {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value.content || value.소관부처명 || "";
}

async function fetchJson(path: string, params: Record<string, string | undefined>): Promise<any> {
    const lawOc = getLawOc();
    if (!lawOc) {
        throw new Error("LAW_OC environment variable is required");
    }

    const query = new URLSearchParams({ OC: lawOc, type: "JSON" });
    Object.entries(params).forEach(([key, value]) => {
        if (value) query.set(key, value);
    });

    const url = `${LAW_BASE_URL}/${path}?${query}`;
    let lastError: any;

    for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(url, { signal: controller.signal });
            const text = await response.text();
            if (!response.ok) {
                const error: any = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
                error.status = response.status;
                throw error;
            }
            try {
                return JSON.parse(text);
            } catch {
                throw new Error(`JSON parse failed: ${text.slice(0, 200)}`);
            }
        } catch (error: any) {
            lastError = error;
            const shouldRetry = isTransientFetchError(error) && attempt < FETCH_MAX_ATTEMPTS;
            if (!shouldRetry) throw error;

            console.warn(`[LawTool] ${path} transient fetch error; retrying (${attempt}/${FETCH_MAX_ATTEMPTS})`, error?.code || error?.cause?.code || error?.name || error?.message);
            await delay(350 * attempt);
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError;
}

function isTransientFetchError(error: any): boolean {
    const code = error?.code || error?.cause?.code;
    const name = error?.name;
    const status = error?.status;
    const message = String(error?.message || "");

    return (
        name === "AbortError" ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ECONNREFUSED" ||
        code === "EAI_AGAIN" ||
        message.includes("fetch failed") ||
        (typeof status === "number" && status >= 500)
    );
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchLaws(query: string, display = 5): Promise<LawSearchItem[]> {
    const data = await fetchJson("lawSearch.do", {
        target: "law",
        query,
        display: String(display),
        page: "1",
    });

    const result = data?.LawSearch;
    if (result?.resultCode && result.resultCode !== "00") {
        throw new Error(`lawSearch failed: ${result.resultCode} ${result.resultMsg || ""}`);
    }

    return asArray<LawSearchItem>(result?.law);
}

async function searchLawCandidates(query: string, display = 5): Promise<LawSearchItem[]> {
    for (const candidate of buildSearchQueries(query)) {
        const laws = await searchLaws(candidate, display);
        if (laws.length > 0) {
            return sortLawSearchItems(laws, candidate);
        }
    }
    return [];
}

function buildSearchQueries(query: string): string[] {
    const normalized = query.trim();
    const compacted = normalized
        .replace(/관련\s*법안|관련\s*법령|주요\s*조항|전체\s*조항|본문|내용|정리|알려줘|보여줘|찾아줘/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const queries = [normalized, compacted];

    if (normalized.includes("소방법")) {
        queries.push("소방기본법", "소방");
    }
    if (normalized.includes("교통법")) {
        queries.push("도로교통법");
    }
    if (normalized.includes("개인정보법")) {
        queries.push("개인정보 보호법");
    }
    if (normalized.includes("근로법")) {
        queries.push("근로기준법");
    }

    return [...new Set(queries.filter(Boolean))];
}

function sortLawSearchItems(laws: LawSearchItem[], query: string): LawSearchItem[] {
    const normalizedQuery = query.replace(/\s+/g, "");
    return [...laws].sort((a, b) => lawSearchRank(a, normalizedQuery) - lawSearchRank(b, normalizedQuery));
}

function lawSearchRank(item: LawSearchItem, normalizedQuery: string): number {
    const name = String(item.법령명한글 || item.법령명 || "").replace(/\s+/g, "");
    if (name === normalizedQuery) return 0;
    if (name.startsWith(normalizedQuery)) return 1;
    if (name.includes(normalizedQuery)) return 2;
    return 3;
}

function normalizeLawItem(item: LawSearchItem) {
    const name = item.법령명한글 || item.법령명 || "";
    const mst = item.법령일련번호 || "";
    const type = item.법령구분명 || "";
    const department = item.소관부처명 || "";
    const promulgationDate = formatDate(item.공포일자);
    const effectiveDate = formatDate(item.시행일자);
    const revisionType = item.제개정구분명 || "";

    return {
        name,
        shortName: item.법령약칭명 || "",
        lawId: item.법령ID || "",
        mst,
        type,
        department,
        promulgationNo: item.공포번호 || "",
        promulgationDate,
        effectiveDate,
        revisionType,
        status: item.현행연혁코드 || "",
        preview: [
            department ? `${department} 소관` : "",
            type,
            revisionType,
            effectiveDate ? `${effectiveDate} 시행` : "",
            promulgationDate ? `${promulgationDate} 공포` : "",
        ].filter(Boolean).join(" · "),
        sourceUrl: name ? `https://www.law.go.kr/법령/${encodeURIComponent(name)}` : "",
    };
}

function normalizeArticle(article: any, options: { mst?: string; lawName?: string } = {}) {
    const clauses = asArray<any>(article?.항).map((clause) => {
        const subItems = asArray<any>(clause?.호).map((item) => ({
            number: item.호번호 || "",
            text: item.호내용 || "",
        })).filter((item) => item.text);

        return {
            number: clause.항번호 || "",
            text: clause.항내용 || "",
            ...(subItems.length > 0 ? { subItems } : {}),
        } satisfies NormalizedClause;
    }).filter((clause) => clause.text);

    const number = formatArticleNumber(article);

    return {
        number,
        title: article?.조문제목 || "",
        text: article?.조문내용 || "",
        effectiveDate: formatDate(article?.조문시행일자),
        changed: article?.조문변경여부 === "Y",
        sourceUrl: buildArticleSourceUrl({
            lawName: options.lawName,
            articleNumber: number,
        }),
        clauses,
    };
}

function formatArticleNumber(article: any): string {
    const raw = String(article?.조문번호 || "");
    const digits = raw.replace(/[^\d]/g, "");
    const baseDigits = digits.length === 6 ? digits.slice(0, 4) : digits;
    const base = baseDigits.replace(/^0+/, "") || raw;
    const branchRaw = String(article?.조문가지번호 || "").replace(/[^\d]/g, "");
    const branch = branchRaw === "00" ? "" : branchRaw.replace(/^0+/, "");
    return branch ? `${base}의${branch}` : base;
}

function buildArticleSourceUrl(params: {
    lawName?: string;
    articleNumber?: string;
}): string {
    if (params.lawName) {
        const articlePath = params.articleNumber ? `/제${encodeURIComponent(params.articleNumber)}조` : "";
        return `https://www.law.go.kr/법령/${encodeURIComponent(params.lawName)}${articlePath}`;
    }

    return "";
}

function articleNumberOrder(value: string): number {
    const match = value.match(/(\d+)(?:의(\d+))?/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Number(match[1]) + Number(match[2] || 0) / 100;
}

function tokenizeQuery(query: string, lawName?: string): string[] {
    const withoutLawName = lawName
        ? query
            .replace(lawName, " ")
            .replace(lawName.replace(/\s+/g, ""), " ")
        : query;
    const rawTokens = withoutLawName
        .replace(/[^\p{Script=Hangul}a-zA-Z0-9\s]/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

    const expanded = new Set(rawTokens);
    if (query.includes("신호위반")) {
        expanded.add("신호");
        expanded.add("지시");
        expanded.add("제5조");
        expanded.add("제156조");
    }
    if (query.includes("음주운전")) {
        expanded.add("술에");
        expanded.add("혈중알코올");
        expanded.add("제44조");
        expanded.add("제148조");
    }
    return [...expanded];
}

function articleSearchText(article: ReturnType<typeof normalizeArticle>): string {
    return [
        `제${article.number}조`,
        article.title,
        article.text,
        ...asArray(article.clauses).flatMap((clause) => [
            clause.text,
            ...asArray(clause.subItems).map((item) => item.text),
        ]),
    ].filter(Boolean).join(" ");
}

function scoreArticles(articles: ReturnType<typeof normalizeArticle>[], query: string, lawName?: string) {
    const tokens = tokenizeQuery(query, lawName);
    if (tokens.length === 0) return articles.slice(0, 20);

    const scored = articles
        .map((article) => {
            const haystack = articleSearchText(article);
            let score = 0;
            for (const token of tokens) {
                if (haystack.includes(token)) score += token.startsWith("제") ? 5 : 2;
                if (article.title?.includes(token)) score += 3;
                if (article.text?.includes(token)) score += 2;
            }
            if (article.title?.includes("벌칙") || article.text?.includes("벌칙")) score += query.includes("처벌") || query.includes("위반") ? 2 : 0;
            return { article, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || articleNumberOrder(a.article.number) - articleNumberOrder(b.article.number))
        .slice(0, 8)
        .map(({ article }) => article);

    return scored.length > 0 ? scored : articles.slice(0, 20);
}

async function fetchLawDetail(params: { lawName?: string; mst?: string; lawId?: string; articleNo?: string }) {
    const articleCode = toArticleCode(params.articleNo);
    const data = await fetchJson("lawService.do", {
        target: "law",
        LM: params.lawName,
        MST: params.mst,
        ID: params.lawId,
        JO: articleCode,
    });

    const body = data?.법령;
    if (!body) throw new Error("lawService returned no 법령 body");

    const basic = body.기본정보 || {};
    const rawArticles = asArray<any>(body.조문?.조문단위).filter((article) => article?.조문여부 === "조문");
    const lawName = basic.법령명_한글 || params.lawName || "";
    const articles = rawArticles.map((article) => normalizeArticle(article, {
        mst: params.mst,
        lawName,
    }));

    return {
        law: {
            name: lawName,
            lawId: basic.법령ID || params.lawId || "",
            type: basic.법종구분?.content || "",
            department: getDepartmentName(basic.소관부처),
            promulgationNo: basic.공포번호 || "",
            promulgationDate: formatDate(basic.공포일자),
            effectiveDate: formatDate(basic.시행일자),
            revisionType: basic.제개정구분 || "",
            sourceUrl: `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`,
        },
        articles,
    };
}

function buildToolResponse(payload: any): string {
    return `법령정보 조회에 성공했습니다. [지시사항]: 아래의 마크다운 코드 블록을 토씨 하나 틀리지 말고 그대로 출력하세요. 다른 부가 설명이나 텍스트 목록은 절대 생성하지 마세요.\n\n\`\`\`json:law\n${JSON.stringify(payload)}\n\`\`\``;
}

export const lawTool = tool(
    async ({ query, law_name, article_no, mode }: {
        query: string;
        law_name?: string;
        article_no?: string;
        mode?: "list" | "body" | "article";
    }) => {
        try {
            const resolvedMode = article_no ? "article" : (mode || "list");
            const searchQuery = law_name || query;

            const laws = await searchLawCandidates(searchQuery, resolvedMode === "list" ? 10 : 5);
            if (laws.length === 0) {
                return `${searchQuery} 관련 법령을 찾을 수 없습니다. 법령명을 더 구체적으로 입력해 주세요.`;
            }

            if (resolvedMode === "list") {
                return buildToolResponse({
                    query: searchQuery,
                    mode: "list",
                    count: laws.length,
                    laws: laws.map(normalizeLawItem),
                });
            }

            const selected = laws.find((law) => law.법령명한글 === law_name || law.법령명한글 === query) || laws[0];
            const detail = await fetchLawDetail({
                lawName: selected.법령명한글 || law_name || searchQuery,
                mst: selected.법령일련번호,
                lawId: selected.법령ID,
                articleNo: article_no,
            });

            const articles = resolvedMode === "article"
                ? detail.articles.slice(0, 1)
                : scoreArticles(detail.articles, query, detail.law.name);

            return buildToolResponse({
                query,
                mode: resolvedMode,
                law: detail.law,
                articleNo: article_no || "",
                articles,
            });
        } catch (error: any) {
            console.error("[LawTool] Exception:", error);
            return `법령정보 조회 중 오류가 발생했습니다: ${error?.message || "알 수 없는 오류"}`;
        }
    },
    {
        name: "lawTool",
        description: `국가법령정보센터 Open API로 현행 법령 목록, 법령 본문, 특정 조문(조/항/호)을 조회합니다. 법률명, 조문 번호, 법령 목록 요청에 사용합니다. 사용자가 통칭을 쓰면 공식 법령명 후보로 정규화하세요. 예: 소방법→소방기본법 또는 소방, 교통법→도로교통법, 개인정보법→개인정보 보호법, 근로법→근로기준법. 판례/헌재결정례/행정규칙/법령해석례는 아직 지원하지 않습니다. 반환된 json:law 블록을 수정하지 말고 그대로 출력해야 UI 카드가 정상 작동합니다.`,
        schema: z.object({
            query: z.string().describe("사용자 질의 원문 또는 검색 키워드. 예: 도로교통법, 음주운전 기준, 개인정보보호법"),
            law_name: z.string().optional().describe("명확히 추출 가능한 법령명 또는 공식 법령명 후보. 예: 도로교통법, 민법, 개인정보 보호법, 소방기본법. 통칭 소방법은 소방기본법 또는 소방으로 검색합니다."),
            article_no: z.string().optional().describe("특정 조문 번호. 예: 제44조, 44, 10조. 항/호가 있어도 조 번호만 입력합니다."),
            mode: z.enum(["list", "body", "article"]).optional().describe("list=법령 목록, body=법령 본문/조문 목록, article=특정 조문. 조번호가 있으면 article을 사용합니다."),
        }),
    }
);
