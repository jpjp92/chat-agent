import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './lib/supabase.js';

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

const CHAT_MODELS = ['gemini-2.5-flash'];

let currentKeyIndex = 0;
const getNextApiKey = () => {
    if (API_KEYS.length === 0) return null;
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { prompt, history, language, attachment, webContent, session_id } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const langNames: any = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
    const currentLang = language || 'ko';

    if (API_KEYS.length === 0) {
        res.write(`data: ${JSON.stringify({ error: 'No API keys found in server environment.' })}\n\n`);
        res.end();
        return;
    }

    let systemInstruction = `You are Gemini 2.5 Flash, Google's next-generation high-performance AI model. 
  CRITICAL: YOUR ENTIRE RESPONSE MUST BE IN ${langNames[currentLang]} ONLY. 
  IF THE USER SPEAKS ANOTHER LANGUAGE, YOU MUST STILL RESPOND IN ${langNames[currentLang]}.
  NEVER switch languages unless explicitly asked to change the translation settings.

  [CORE DIRECTIVE: SOURCE ADHERENCE]
  - If "PROVIDED_SOURCE_TEXT" is provided, it contains the actual content of the URL or ATTACHED DOCUMENT the user is asking about.
  - You MUST prioritize PROVIDED_SOURCE_TEXT over your internal knowledge or general search results for that specific source.
  - If PROVIDED_SOURCE_TEXT contains "[YOUTUBE_VIDEO_INFO]", it is a YouTube video. You are provided with Title, Channel, and Description. **IMPORTANT**: For shorter videos, you also have direct visual/auditory access via a multimodal 'fileUri' in the request parts. If a 'fileUri' part is present, you can "watch" and "listen" to the video directly. If it is NOT present, it means the video is too long or rich enough in metadata for a fast summary—in this case, use the provided Title and Description as your primary source. NEVER say "I cannot analyze video content"; always use the best available information to assist the user.
  - If PROVIDED_SOURCE_TEXT contains "[PAPER INFO]", it's an Arxiv paper. Use the Title, Authors, and Abstract provided.
  - If PROVIDED_SOURCE_TEXT contains "[EXTRACTED_DOCUMENT_CONTENT]", it's the text from a user-uploaded file (Word, TXT, etc.).
  - If PROVIDED_SOURCE_TEXT contains "[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT]", it is a document previously uploaded in the current session. Use it as background context for follow-up questions.
  - If PROVIDED_SOURCE_TEXT contains "[CSV DATA CONVERTED TO MARKDOWN TABLE]" or "[XLSX DATA CONVERTED TO MARKDOWN TABLE]", it is a spreadsheet file precisely converted into a Markdown table. You MUST treat this as a structured dataset where row-column relationships are critical for accuracy.
  - If the user asks for a summary or has questions about the source, use PROVIDED_SOURCE_TEXT as the primary basis.
  - If PROVIDED_SOURCE_TEXT is missing, very short, or you need more data (EXCEPT for YouTube), use the 'googleSearch' tool.
  - DO NOT hallucinate details not present in the source or search results.
  
  [FORMATTING & QUALITY]
  - DO NOT output internal thought processes, planning steps, or draft headers (e.g., "| Col | Col |").
  - Output ONLY the final, polished response intended for the user.
  - Ensure all Markdown syntax (tables, code blocks) is complete and valid.
  - [TABLE STYLE GUIDE]
    - strictly follow the format: | Header | Header |\n| --- | --- |\n| Row | Row |.
    - Keep table headers as SHORT as possible (e.g., use "경기" instead of "경기수", "득점" instead of "득점수").
    - If there are many columns, prioritize compactness.`;

    if (webContent) {
        systemInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${webContent} `;
    }

    const contents: any[] = history
        .filter((msg: any) => msg.content && msg.content.trim() !== "" && msg.role !== 'system')
        .slice(-10)
        .map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

    let userParts: any[] = [{ text: prompt }];

    // YouTube Smart Hybrid Logic
    const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const ytMatch = prompt.match(ytRegex) || (webContent && webContent.match(ytRegex));
    if (ytMatch) {
        const normalizedYtUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
        userParts.push({ fileData: { fileUri: normalizedYtUrl, mimeType: 'video/mp4' } });
    }

    if (attachment && attachment.data) {
        const base64Data = attachment.data.includes(',') ? attachment.data.split(',')[1] : attachment.data;
        userParts.push({ inlineData: { data: base64Data, mimeType: attachment.mimeType } });
    }
    contents.push({ role: 'user', parts: userParts });

    const isYoutubeRequest = !!ytMatch;

    // Supabase: User 메시지 즉시 저장 (비동기)
    if (session_id) {
        supabase.from('chat_messages').insert({
            session_id,
            role: 'user',
            content: prompt,
            attachment_url: attachment?.data && attachment.data.startsWith('http') ? attachment.data : (attachment?.mimeType || null)
        }).then(({ error }) => {
            if (error) console.error('[Chat API] User message save error:', error);
        });
    }

    // Failover Loop
    let lastError = 'No attempts made';
    for (const currentModel of CHAT_MODELS) {
        for (let k = 0; k < API_KEYS.length; k++) {
            const apiKey = getNextApiKey();
            if (!apiKey) continue;

            try {
                const ai = new GoogleGenAI({ apiKey });
                const result = await ai.models.generateContentStream({
                    model: currentModel,
                    contents,
                    config: {
                        systemInstruction,
                        tools: isYoutubeRequest ? [] : [{ googleSearch: {} }],
                        temperature: 0.4,
                        topP: 0.8,
                        topK: 40,
                        maxOutputTokens: 4096
                    }
                });

                let fullAiResponse = '';
                const allSources: any[] = [];
                for await (const chunk of result) {
                    const chunkText = chunk.text;
                    if (chunkText) {
                        fullAiResponse += chunkText;
                        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
                    }

                    // [CITATIONS] Grounding Metadata 추출 및 전송
                    const metadata = chunk.candidates?.[0]?.groundingMetadata;
                    if (metadata && metadata.groundingChunks) {
                        const sources = metadata.groundingChunks
                            .map((gc: any) => gc.web ? { title: gc.web.title, uri: gc.web.uri } : null)
                            .filter(Boolean);

                        if (sources.length > 0) {
                            // 중복 제거 및 누적
                            sources.forEach((s: any) => {
                                if (!allSources.some(existing => existing.uri === s.uri)) {
                                    allSources.push(s);
                                }
                            });
                            res.write(`data: ${JSON.stringify({ sources })}\n\n`);
                        }
                    }
                }


                // Supabase: AI 응답 저장 (동기적으로 대기하여 저장 보장)
                if (session_id && fullAiResponse) {
                    try {
                        const { error: msgError } = await supabase.from('chat_messages').insert({
                            session_id,
                            role: 'assistant',
                            content: fullAiResponse,
                            grounding_sources: allSources.length > 0 ? allSources : null
                        });
                        if (msgError) throw msgError;

                        await supabase.from('chat_sessions')
                            .update({ updated_at: new Date().toISOString() })
                            .eq('id', session_id);
                    } catch (e) {
                        console.error('[Chat API] Assistant message save error:', e);
                    }
                }
                res.end();
                return;
            } catch (error: any) {
                lastError = error.message || String(error);
                console.error(`Attempt failed: Model=${currentModel}, KeyIndex=${k}, Error=${lastError}`);
            }
        }
    }

    res.write(`data: ${JSON.stringify({ error: `All attempts failed. Last error: ${lastError}` })}\n\n`);
    res.end();
}
