import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited } from './_lib/config.js';

const SUMMARY_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const TITLE_PROMPTS: any = {
    ko: "위 대화 내용의 핵심 주제를 담은 제목을 한국어로 10단어 이내로 지어줘. 너무 짧게 줄이지 말고 내용이 무엇인지 알 수 있게 써줘. 따옴표는 빼고 제목만 출력해줘.",
    en: "Create a descriptive title summarizing the conversation in English within 10 words. Make it informative enough to convey the topic. Output only the title without quotes.",
    es: "Crea un título descriptivo que resuma la conversación en español en menos de 10 palabras. Hazlo informativo. Muestra solo el título sin comillas.",
    fr: "Créez un titre descriptif résumant la conversation en français en moins de 10 mots. Rendez-le informatif. Affichez uniquement le titre sans guillemets."
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

    const chatHistoryText = history.slice(-6).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join("\n");

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
                            text: `${TITLE_PROMPT}\n\n[대화 내용]\n${chatHistoryText}\n\n제목:`
                        }]
                    }],
                    config: {
                        temperature: 0.3,
                        maxOutputTokens: 200  // 한국어 10단어 여유분 포함
                    }
                });

                if (response.text) {
                    const title = response.text.trim().replace(/["']/g, "");
                    return res.status(200).json({ title });
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
