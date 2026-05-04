import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited } from './_lib/config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { text } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Text is required' });
    if (text.length > 10000) return res.status(400).json({ error: 'Text too long' });

    if (API_KEYS.length === 0) {
        return res.status(500).json({ error: 'No API keys found in server environment.' });
    }

    for (let k = 0; k < API_KEYS.length; k++) {
        const apiKey = getNextApiKey();
        if (!apiKey) continue;
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-tts',
                contents: [{ parts: [{ text: text.slice(0, 2000) }] }],
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } as any,
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) continue;

            return res.status(200).json({ data: base64Audio });
        } catch (error: any) {
            const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit && apiKey) markKeyRateLimited(apiKey);
            console.error('[Speech API] Failed for key:', { status: error?.status, message: error?.message });
        }
    }

    return res.status(500).json({ error: "Failed to generate speech" });
}
