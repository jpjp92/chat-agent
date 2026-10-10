import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from '../../../server/config';
import { SUMMARY_MODELS } from '../../../server/models';
import { createRouteClient, unauthorized, isAuthError } from '../../../lib/supabase/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TITLE_PROMPTS: Record<string, string> = {
    ko: "아래 대화의 핵심 내용을 담은 완결된 명사형 제목을 한국어로 만들어줘. '~앞두고', '~관련' 같은 미완성 구로 끝내지 말고, 무슨 내용인지 한눈에 알 수 있게 써줘. 단어 수는 5~15단어 사이. 따옴표 없이 제목만 출력.",
    en: "Write a complete, self-contained title for the conversation below. Do not use trailing phrases like 'ahead of...' or 'regarding...'. Make it informative at a glance, 5–15 words. Output only the title without quotes.",
    es: "Escribe un título completo y autónomo para la conversación. No uses frases incompletas. Hazlo informativo, entre 5 y 15 palabras. Solo el título, sin comillas.",
    fr: "Écris un titre complet et autonome pour la conversation. Pas de phrases incomplètes. Informatif en un coup d'œil, 5 à 15 mots. Uniquement le titre, sans guillemets."
};

const stripMarkdown = (t: string) => t.replace(/```[\s\S]*?```/g, '').replace(/[*_`>#~\[\]]/g, '').replace(/\s+/g, ' ').trim();
const stripUrls = (t: string) => t.replace(/https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ').trim();

export async function POST(req: NextRequest) {
    // 인증 — 무인증이면 누구나 우리 키로 LLM 을 부를 수 있다(10-09 감사 최우선).
    // createRouteClient 는 Bearer 존재만 본다. 위조 토큰은 PostgREST 가 거르지만, **공개 anon 키**를
    // Bearer 로 보내면 유효 JWT(role=anon)라 에러 없이 빈 결과가 온다 → 프로필 행이 있어야 통과.
    // (모든 auth 유저는 가입 트리거로 profiles 행을 갖는다 — auth-mvp-schema.sql)
    const db = createRouteClient(req);
    if (!db) return unauthorized();
    const { data: profile, error: authError } = await db.from('profiles').select('id').maybeSingle();
    if (authError) {
        if (isAuthError(authError)) return unauthorized();
        console.error('[Title API] Auth check error:', authError.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!profile) return unauthorized();

    const { history, language } = await req.json();
    const currentLang = language || 'ko';
    const TITLE_PROMPT = TITLE_PROMPTS[currentLang] ?? TITLE_PROMPTS.ko;

    if (!history) return NextResponse.json({ error: 'History is required' }, { status: 400 });
    if (API_KEYS.length === 0) return NextResponse.json({ title: 'New Chat' });

    const chatHistoryText = history.slice(-6).map((m: any) => {
        if (m.role === 'user') return `User: ${stripUrls(m.content)}`;
        const plain = stripMarkdown(m.content || '');
        return `Assistant: ${plain.slice(0, 500)}${plain.length > 500 ? '...' : ''}`;
    }).join('\n');

    for (const model of SUMMARY_MODELS) {
        let modelUnavailable = false;
        for (let k = 0; k < API_KEYS.length; k++) {
            if (modelUnavailable) break;
            const apiKey = getNextApiKey();
            if (!apiKey) continue;
            try {
                const ai = new GoogleGenAI({ apiKey });
                const response = await ai.models.generateContent({
                    model,
                    contents: [{ parts: [{ text: `${TITLE_PROMPT}\n\n[대화 내용]\n${chatHistoryText}` }] }],
                    config: { temperature: 0.3, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
                });
                if (response.text) {
                    const firstLine = response.text.split('\n').map((l: string) => l.trim()).find((l: string) => l.length > 0) ?? '';
                    const title = firstLine.replace(/["'「」『』]/g, '').trim();
                    if (title) return NextResponse.json({ title });
                }
            } catch (error: any) {
                const status = error?.status;
                const isRateLimit = status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
                const isUnavailable = status === 503 || error?.message?.includes('503') || error?.message?.includes('UNAVAILABLE');
                if (isUnavailable) { modelUnavailable = true; break; }
                if (isRateLimit && apiKey) {
                    isDailyQuotaError(error) ? markKeyDailyExhausted(apiKey) : markKeyRateLimited(apiKey);
                }
            }
        }
    }
    return NextResponse.json({ title: 'New Chat' });
}
