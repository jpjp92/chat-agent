/**
 * 날씨 + 카드 밖 정보(미세먼지·자외선…) 복합 질문의 검색 답 — PLAN_WEATHER_COMPOSITE_261125.
 *
 * 카드는 그대로 두고 카드에 없는 부분만 찾는다. **생성기와 같은 모델이 검색한다** — 사용자가 GPT 를 골랐으면
 * GPT(web_search), Gemini 면 Gemini(grounding). 다음 턴에 "미세먼지는?" 이라고 따로 물을 때와 같은 모델이어야 한다.
 * Gemini 3.x 는 무료 키 검색이 429 라 생성기는 역할 모델로 내리는데, 여기서는 **검색하지 않는다** — 역할 모델(3.5 FL)
 * 검색은 한 문장에 9.5s(중앙값, 11-26 실측 8회)로 GPT 3.7s·3.8 Flash 5.8s 보다 느렸다. 무료 키는 null 을 돌려
 * 호출부가 역할 모델 답("미세먼지도 찾아볼까요?")으로 바로 답하고, 원하면 다음 턴(`lookup`)에 찾는다.
 * 실패해도 null — 같은 폴백.
 */
import { GoogleGenAI } from '@google/genai';
import { HumanMessage } from '@langchain/core/messages';
import { getNextApiKey, isPaidKey, markKeyRateLimited } from '../config';
import { modelCaps, roleGenConfig } from '../models';
import { isOpenAIChatModel } from '../openai/models';
import { generateOpenAIChat } from '../openai/chat';
import { buildWeatherExtraPrompt } from './weather-answer-prompt';
import type { WeatherLang } from '../../lib/weather-labels';

// 검색 왕복이 붙는다 — 카드는 이미 나갔으니 답 한 단락을 기다리는 시간
const WEATHER_EXTRA_TIMEOUT_MS = 25_000;
const INSTRUCTIONS = 'You add a short, sourced answer under a weather card. Follow the user turn exactly.';

type Source = { title: string; uri: string };

export async function weatherExtraAnswer(args: {
    question: string; cards: any[]; lang: WeatherLang; today: string; extra: string; model: string;
}): Promise<{ text: string; sources: Source[]; model: string } | null> {
    const prompt = buildWeatherExtraPrompt(args.question, args.cards, args.lang, args.today, args.extra);
    const startedAt = Date.now();
    try {
        if (isOpenAIChatModel(args.model)) {
            const r = await generateOpenAIChat({
                model: args.model, messages: [new HumanMessage(prompt)], instructions: INSTRUCTIONS,
                useWebSearch: true, maxOutputTokens: 8192, timeoutMs: WEATHER_EXTRA_TIMEOUT_MS,
            });
            console.log(`[weather] 카드 밖 검색 ${args.model} ${Date.now() - startedAt}ms sources=${r.sources.length}`);
            return r.text.trim() ? { text: r.text.trim(), sources: r.sources.map(s => ({ title: s.title, uri: s.uri })), model: args.model } : null;
        }
        const apiKey = getNextApiKey();
        if (!apiKey) return null;
        const caps = modelCaps(args.model);
        if ((!caps.freeTierSearch && !isPaidKey(apiKey)) || !caps.groundingReliable) {
            console.log(`[weather] 카드 밖 검색 생략 ${args.model}(무료 키·역할 모델 강등) → 역질문`);
            return null;
        }
        const model = args.model;
        try {
            const res = await new GoogleGenAI({ apiKey }).models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                // 가장 낮은 thinking — 1~3문장 검색 답에 기본 thinking 은 13~23s 였다(3.8 Flash, 11-25 실측 4회)
                config: { tools: [{ googleSearch: {} }], maxOutputTokens: 8192, abortSignal: AbortSignal.timeout(WEATHER_EXTRA_TIMEOUT_MS), ...roleGenConfig(model) },
            });
            const chunks: any[] = (res as any).candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
            const sources = chunks.map(c => c?.web).filter((w: any) => w?.uri).map((w: any) => ({ title: String(w.title ?? w.uri), uri: String(w.uri) }));
            const text = (res.text ?? '').trim();
            console.log(`[weather] 카드 밖 검색 ${model} ${Date.now() - startedAt}ms sources=${sources.length}`);
            return text ? { text, sources, model } : null;
        } catch (error: any) {
            if (error?.status === 429) markKeyRateLimited(apiKey);
            throw error;
        }
    } catch (error: any) {
        console.warn(`[weather] 카드 밖 검색 실패 ${args.model} ${Date.now() - startedAt}ms`, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : error?.status ?? 'error');
        return null;
    }
}
