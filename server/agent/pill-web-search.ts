/**
 * 약 식별 웹 폴백 검색 — DB 두 곳에서 각인으로 못 찾았을 때만 부른다(PLAN_PILL_IDENTIFY_261128).
 *
 * DuckDuckGo HTML 스크래핑은 11-28 로컬에서 Node fetch 요청이 전부 봇 확인(202 anomaly)으로 막혀 0건이었다(curl 은 통과).
 * 그래서 앱이 이미 쓰는 모델 검색으로 바꾼다 — weather-extra.ts 와 같은 규칙: 사용자가 고른 모델이 검색한다
 * (GPT 면 web_search, Gemini 면 grounding). 무료 키·검색 못 믿는 모델이면 null → 호출부가 DDG 로 한 번 더 시도.
 * 지연: 폴백이 필요한 경우에만 모델 호출 1회가 붙는다.
 */
import { GoogleGenAI } from '@google/genai';
import { HumanMessage } from '@langchain/core/messages';
import { getNextApiKey, isPaidKey, markKeyRateLimited } from '../config';
import { modelCaps, roleGenConfig } from '../models';
import { isOpenAIChatModel } from '../openai/models';
import { generateOpenAIChat } from '../openai/chat';
import { PILL_DOMAINS, parsePillWebCandidates, type PillWebCandidate } from './pill-web-candidates';

const PILL_WEB_TIMEOUT_MS = 15_000;
const buildPrompt = (query: string) =>
    `다음 알약을 낱알 식별 정보로 찾아라. 검색어: ${query}\n`
    + `- 따옴표 안 각인 글자를 포함하는 제품 최대 5개(로고·다른 면 각인은 달라도 된다), 한 줄에 하나씩 정확히 이 형식으로만 쓴다:\n`
    + `후보|제품명|제조사|각인|제형|색상|출처URL\n`
    + `- 출처URL 은 그 제품을 확인한 검색 결과 페이지 주소. 근거 페이지가 없는 제품은 쓰지 않는다. 추측하지 않는다.\n`
    + `- 하나도 없으면 "없음" 한 줄만 쓴다. 다른 설명은 쓰지 않는다.`;

// Gemini grounding 은 출처를 불투명 리디렉트 주소로 준다 — 모델이 그대로 쓰면 도메인 필터에서 후보가 버려졌다(11-28, 4개 중 1개).
// 실제 주소를 Location 헤더로 풀어 도메인을 확인한다. 병렬·짧은 타임아웃이라 지연은 작다.
const REDIRECT_RE = /https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s|)\]]+/g;
async function resolveGroundingRedirects(text: string): Promise<string> {
    const urls = [...new Set(text.match(REDIRECT_RE) ?? [])];
    if (urls.length === 0) return text;
    const resolved = await Promise.all(urls.map(async u => {
        try {
            const r = await fetch(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(2_000) });
            return [u, r.headers.get('location') ?? ''] as const;
        } catch { return [u, ''] as const; }
    }));
    let out = text;
    for (const [u, loc] of resolved) if (loc) out = out.split(u).join(loc);
    return out;
}

/** 구조화 후보와 출처를 돌려준다. 실패·생략은 null — 호출부가 DDG 로 한 번 더 시도. */
export async function pillWebSearch(query: string, model: string): Promise<{ candidates: PillWebCandidate[]; sources: string[] } | null> {
    const startedAt = Date.now();
    const format = (text: string, sources: { uri: string }[]) => {
        const uris = sources.map(s => s.uri);
        const candidates = parsePillWebCandidates(text);
        console.log(`[pill-web] ${model} ${Date.now() - startedAt}ms sources=${uris.length} candidates=${candidates.length}`);
        return { candidates, sources: uris };
    };
    try {
        if (isOpenAIChatModel(model)) {
            const r = await generateOpenAIChat({
                model, messages: [new HumanMessage(buildPrompt(query))], instructions: 'You identify pills from imprint search results only.',
                useWebSearch: true, webSearchDomains: PILL_DOMAINS, maxOutputTokens: 4096, timeoutMs: PILL_WEB_TIMEOUT_MS,
            });
            return format(r.text, r.sources);
        }
        const apiKey = getNextApiKey();
        if (!apiKey) return null;
        const caps = modelCaps(model);
        if ((!caps.freeTierSearch && !isPaidKey(apiKey)) || !caps.groundingReliable) {
            console.log(`[pill-web] 모델 검색 생략 ${model}(무료 키·검색 신뢰 낮음) → DDG`);
            return null;
        }
        try {
            const res = await new GoogleGenAI({ apiKey }).models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: buildPrompt(query) }] }],
                config: { tools: [{ googleSearch: {} }], maxOutputTokens: 4096, abortSignal: AbortSignal.timeout(PILL_WEB_TIMEOUT_MS), ...roleGenConfig(model) },
            });
            const chunks: any[] = (res as any).candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
            const sources = chunks.map(c => c?.web).filter((w: any) => w?.uri).map((w: any) => ({ uri: String(w.uri) }));
            return format(await resolveGroundingRedirects(res.text ?? ''), sources);
        } catch (error: any) {
            if (error?.status === 429) markKeyRateLimited(apiKey);
            throw error;
        }
    } catch (error: any) {
        console.warn(`[pill-web] 실패 ${model} ${Date.now() - startedAt}ms`, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : error?.status ?? 'error');
        return null;
    }
}
