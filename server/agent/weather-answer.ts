/**
 * 날씨 카드 뒤 짧은 답 — 질문이 카드 수치 이상을 물을 때만(우산·옷차림·외출·어느 날…) 1~2문장.
 *
 * 왜: 첫 날씨 질문은 fast-pass 라 카드 + 템플릿 한 줄(weather-summary.ts)만 나간다. "우산 챙겨야 할까?" 가
 * 같이 와도 답이 없었다(11-25 실화면). 템플릿은 조언을 넣지 않는 게 맞다 — 묻지 않은 질문에 답하게 된다.
 *  · 카드를 먼저 보내고, 답은 그래프가 끝난 뒤 route 가 붙인다 — Gemini(langchain fast-pass)·GPT(함수 호출
 *    fast-pass) 두 경로가 모두 "본문 = 카드 + 템플릿" 으로 끝나 한 곳에서 처리된다.
 *  · 날씨만 물었는지는 키워드가 아니라 모델이 판단한다(NONE) — 규칙으로 가르면 표현마다 덧대야 한다.
 *  · 짧게: 수치는 카드·템플릿이 이미 보여 준다. 자세한 분석은 다음 턴(카드가 떠 있으면 후속 규칙이 카드 데이터로 답한다).
 */
import { GoogleGenAI } from '@google/genai';
import { getRoleApiKey, markKeyRateLimited } from '../config';
import { ROLE_MODEL, roleGenConfig } from '../models';
import { NONE, buildWeatherAnswerPrompt } from './weather-answer-prompt';
import type { WeatherLang } from '../../lib/weather-labels';

const WEATHER_ANSWER_TIMEOUT_MS = 6_000;

/** 붙일 답(없으면 ''). 실패·시간 초과·NONE 모두 '' — 카드와 한 줄은 이미 나갔다. */
export async function weatherQuickAnswer(question: string, cards: any[], lang: WeatherLang, today: string): Promise<string> {
    const apiKey = getRoleApiKey();
    if (!apiKey || !question.trim()) return '';
    const startedAt = Date.now();
    try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
            model: ROLE_MODEL,
            contents: [{ role: 'user', parts: [{ text: buildWeatherAnswerPrompt(question, cards, lang, today) }] }],
            config: {
                maxOutputTokens: 200,
                abortSignal: AbortSignal.timeout(WEATHER_ANSWER_TIMEOUT_MS),
                ...roleGenConfig(ROLE_MODEL, { sampling: { temperature: 0.3 } }),
            },
        });
        const text = (res.text ?? '').trim();
        const answered = !!text && !text.toUpperCase().startsWith(NONE);
        console.log(`[weather] 카드 뒤 답 ${answered ? 'answered' : 'none'} ${Date.now() - startedAt}ms`);
        return answered ? text : '';
    } catch (error: any) {
        if (error?.status === 429) markKeyRateLimited(apiKey);
        console.warn(`[weather] 카드 뒤 답 실패 ${Date.now() - startedAt}ms`, error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : error?.status ?? 'error');
        return '';
    }
}
