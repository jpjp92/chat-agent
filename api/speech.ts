import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY2,
    process.env.API_KEY3,
    process.env.API_KEY4,
    process.env.API_KEY5,
    process.env.API_KEY6,
    process.env.API_KEY7,
    process.env.API_KEY8,
].filter(Boolean) as string[];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    if (API_KEYS.length === 0) {
        return res.status(500).json({ error: 'No API keys found in server environment.' });
    }

    for (const apiKey of API_KEYS) {
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
            console.error("Speech generation failed for key", error);
        }
    }

    return res.status(500).json({ error: "Failed to generate speech" });
}
