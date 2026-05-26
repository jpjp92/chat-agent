import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from '../../../api/_lib/config';
import { SUMMARY_MODELS } from '../../../api/_lib/models';

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
