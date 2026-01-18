import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY2,
    process.env.API_KEY3,
    process.env.API_KEY4,
    process.env.API_KEY5,
].filter(Boolean) as string[];

const SUMMARY_MODELS = ['gemma-3-4b-it'];
const TITLE_PROMPTS: any = {
    ko: "위 대화 내용을 요약하는 아주 짧고 간결한 제목을 한국어로 5단어 이내로 지어줘. 따옴표는 빼고 제목만 출력해줘.",
    en: "Create a very short and concise title summarizing the conversation in English within 5 words. Output only the title without quotes.",
    es: "Crea un título muy corto y conciso que resuma la conversación en español en menos de 5 palabras. Muestra solo el título sin comillas.",
    fr: "Créez un titre très court et concis résumant la conversation en français en moins de 5 mots. Affichez uniquement le titre sans guillemets."
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { history, language } = req.body;
    const currentLang = language || 'ko';
    const TITLE_PROMPT = TITLE_PROMPTS[currentLang] || TITLE_PROMPTS.ko;

    console.log('[Title API] Request received:', {
        historyLength: history?.length,
        hasHistory: !!history
    });

    if (!history) {
        console.log('[Title API] No history provided');
        return res.status(400).json({ error: 'History is required' });
    }

    if (API_KEYS.length === 0) {
        console.log('[Title API] No API keys configured');
        return res.status(200).json({ title: "New Chat" });
    }

    const chatHistoryText = history.slice(-6).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join("\n");

    console.log('[Title API] Chat history prepared:', {
        messageCount: history.slice(-6).length,
        textLength: chatHistoryText.length
    });

    // Try each model with each API key
    for (const model of SUMMARY_MODELS) {
        for (const apiKey of API_KEYS) {
            try {
                console.log(`[Title API] Trying model: ${model}`);

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
                        maxOutputTokens: 512  // Generous limit to ensure complete title generation
                    }
                });

                console.log('[Title API] Response received:', {
                    hasText: !!response.text,
                    textLength: response.text?.length
                });

                if (response.text) {
                    const title = response.text.trim().replace(/["']/g, "");
                    console.log('[Title API] Success! Generated title:', title);
                    return res.status(200).json({ title });
                } else {
                    console.log('[Title API] No text in response, trying next key/model');
                    continue;
                }
            } catch (error: any) {
                console.error(`[Title API] Failed with model ${model}:`, {
                    message: error.message,
                    name: error.name,
                    stack: error.stack?.split('\n')[0]
                });
            }
        }
    }

    console.log('[Title API] All attempts failed, returning default');
    return res.status(200).json({ title: "New Chat" });
}
