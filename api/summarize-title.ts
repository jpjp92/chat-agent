import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited } from './_lib/config.js';

const SUMMARY_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const TITLE_PROMPTS: any = {
    ko: "아래 대화의 핵심 내용을 담은 완결된 명사형 제목을 한국어로 만들어줘. '~앞두고', '~관련' 같은 미완성 구로 끝내지 말고, 무슨 내용인지 한눈에 알 수 있게 써줘. 단어 수는 5~15단어 사이. 따옴표 없이 제목만 출력.",
    en: "Write a complete, self-contained title for the conversation below. Do not use trailing phrases like 'ahead of...' or 'regarding...'. Make it informative at a glance, 5–15 words. Output only the title without quotes.",
    es: "Escribe un título completo y autónomo para la conversación. No uses frases incompletas. Hazlo informativo, entre 5 y 15 palabras. Solo el título, sin comillas.",
    fr: "Écris un titre complet et autonome pour la conversation. Pas de phrases incomplètes. Informatif en un coup d'œil, 5 à 15 mots. Uniquement le titre, sans guillemets."
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { history, language } = req.body;
    const currentLang = language || 'ko';
    const TITLE_PROMPT = TITLE_PROMPTS[currentLang] || TITLE_PROMPTS.ko;

    if (!history) {
        return res.status(400).json({ error: 'History is required' });
    }

    if (API_KEYS.length === 0) {
        return res.status(200).json({ title: "New Chat" });
    }

    const stripMarkdown = (text: string) =>
        text.replace(/```[\s\S]*?```/g, '').replace(/[*_`>#~\[\]]/g, '').replace(/\s+/g, ' ').trim();

    const stripUrls = (text: string) =>
        text.replace(/https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ').trim();

    const chatHistoryText = history.slice(-6).map((m: any) => {
        if (m.role === 'user') return `User: ${stripUrls(m.content)}`;
        const plain = stripMarkdown(m.content || '');
        return `Assistant: ${plain.slice(0, 500)}${plain.length > 500 ? '...' : ''}`;
    }).join("\n");

    // Try each model with each API key
    for (const model of SUMMARY_MODELS) {
        for (let k = 0; k < API_KEYS.length; k++) {
            const apiKey = getNextApiKey();
            if (!apiKey) continue;
            try {
                const ai = new GoogleGenAI({ apiKey });
                const response = await ai.models.generateContent({
                    model: model,
                    contents: [{
                        parts: [{
                            text: `${TITLE_PROMPT}\n\n[대화 내용]\n${chatHistoryText}`
                        }]
                    }],
                    config: {
                        temperature: 0.3,
                        maxOutputTokens: 400,
                        thinkingConfig: { thinkingBudget: 0 },
                    }
                });

                if (response.text) {
                    // Take only the first non-empty line — prevents explanation bleed after the title
                    const firstLine = response.text
                        .split('\n')
                        .map((l: string) => l.trim())
                        .find((l: string) => l.length > 0) ?? '';
                    const title = firstLine.replace(/["'「」『』]/g, '').trim();
                    if (title) return res.status(200).json({ title });
                } else {
                    continue;
                }
            } catch (error: any) {
                const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
                if (isRateLimit && apiKey) markKeyRateLimited(apiKey);
                console.error(`[Title API] Failed with model ${model}:`, { status: error?.status, message: error.message });
            }
        }
    }

    return res.status(200).json({ title: "New Chat" });
}
