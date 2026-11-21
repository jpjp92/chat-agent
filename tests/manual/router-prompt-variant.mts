/**
 * 라우터 프롬프트 변형 A/B — 운영 코드를 바꾸지 않고 프로브에서만 Gemini 요청의 systemInstruction 을 고친다.
 * `ROUTER_VARIANT=reasoning` 이면 출력 JSON 맨 앞에 "reasoning"(사용자가 무엇을 받고 싶은가, 한 문장)을 쓰게 한다.
 * 참고: reference/Wireless-Value-Added-Agent 의 1차 의도 분류가 reasoning 을 먼저 출력한다(10-23 검토).
 *
 * 프로브 맨 앞에서 import 한다(라우터 import 전). 변형이 하나라도 적용되지 않으면 측정이 무효이므로 예외를 던진다.
 */
const VARIANT = process.env.ROUTER_VARIANT ?? '';
export const variantStats = { calls: 0, outputTokens: 0 };

const ANCHOR = 'Output ONLY a JSON object exactly like this:\n{"intent"';
const REASONING = 'Output ONLY a JSON object exactly like this. Write "reasoning" FIRST — one short sentence on what the user actually wants back (an answer, a lookup card, or a visual) — then decide every other field from it:\n{"reasoning": "…", "intent"';

// `ROUTER_VARIANT=reformat` — (11-21 운영 반영됨: 이제 운영 문구 위에 한국어 예시를 더하는 실험용) needs_search false 줄에 "직전 답 가공은 직전이 검색이었어도 false, 낡음·틀림 지적은 true" 를 덧붙인다(PLAN_RECENCY_SEARCH_261120 §7)
const SEARCH_FALSE_ANCHOR = 'or summarizing/processing what was already discussed in this conversation.';
const SEARCH_FALSE_REFORMAT = SEARCH_FALSE_ANCHOR + ' This holds even when the previous answer came from a search: reformatting, shortening, translating, or tabulating the previous answer (e.g. "put that in a table", "in one line") is false. But if the user says the previous answer is outdated or wrong, or asks for facts that are not in it, it is true — even when it is a short reply with no question word (e.g. "그건 옛날 얘기잖아", "그 정보 틀렸어", "isn\'t that old?").';

if (VARIANT) {
    if (VARIANT !== 'reasoning' && VARIANT !== 'reformat') throw new Error(`알 수 없는 ROUTER_VARIANT: ${VARIANT}`);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init?: any) => {
        const u = String(url instanceof Request ? url.url : url);
        if (!u.includes('generativelanguage.googleapis.com') || !u.includes(':generateContent') || typeof init?.body !== 'string') {
            return realFetch(url, init);
        }
        const body = JSON.parse(init.body);
        const parts: { text?: string }[] = body.systemInstruction?.parts ?? [];
        const [anchor, replacement] = VARIANT === 'reformat' ? [SEARCH_FALSE_ANCHOR, SEARCH_FALSE_REFORMAT] : [ANCHOR, REASONING];
        const part = parts.find(p => p.text?.includes(anchor));
        if (!part) throw new Error('ROUTER_VARIANT: 앵커를 찾지 못했다 — router.ts 프롬프트가 바뀌었는지 확인');
        part.text = part.text!.replace(anchor, replacement);
        const res = await realFetch(url, { ...init, body: JSON.stringify(body) });
        variantStats.calls++;
        try { variantStats.outputTokens += (await res.clone().json())?.usageMetadata?.candidatesTokenCount ?? 0; } catch { /* 집계만 실패 */ }
        return res;
    };
    console.log(`[variant] ROUTER_VARIANT=${VARIANT} — 라우터 systemInstruction 을 프로브에서 고친다`);
}
