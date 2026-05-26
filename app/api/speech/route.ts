import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from '../../../server/config';
import { SERVER_MODELS } from '../../../server/models';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const { text } = await req.json();
    if (!text || typeof text !== 'string') return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    if (text.length > 10000) return NextResponse.json({ error: 'Text too long' }, { status: 400 });
    if (API_KEYS.length === 0) return NextResponse.json({ error: 'No API keys configured' }, { status: 500 });

    for (let k = 0; k < API_KEYS.length; k++) {
        const apiKey = getNextApiKey();
        if (!apiKey) continue;
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: SERVER_MODELS.TTS,
                contents: [{ parts: [{ text: text.slice(0, 2000) }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } as any,
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) continue;
            return NextResponse.json({ data: base64Audio });
        } catch (error: any) {
            const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit && apiKey) {
                isDailyQuotaError(error) ? markKeyDailyExhausted(apiKey) : markKeyRateLimited(apiKey);
            }
        }
    }
    return NextResponse.json({ error: 'Failed to generate speech' }, { status: 500 });
}
