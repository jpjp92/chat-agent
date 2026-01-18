import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY2,
    process.env.API_KEY3,
    process.env.API_KEY4,
    process.env.API_KEY5,
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

    const { prompt, history, language, attachment, webContent } = req.body;

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

    let systemInstruction = `You are a professional AI assistant. Respond in ${langNames[currentLang]}. 
  
  [CORE DIRECTIVE: SOURCE ADHERENCE]
  - If "PROVIDED_SOURCE_TEXT" is provided, it contains the actual content of the URL the user is asking about.
  - You MUST prioritize PROVIDED_SOURCE_TEXT over your internal knowledge or general search results for that specific URL.
  - If PROVIDED_SOURCE_TEXT contains "[YOUTUBE_VIDEO_INFO]", it is a YouTube video. You are provided with Title, Channel, and Description. **IMPORTANT**: For shorter videos, you also have direct visual/auditory access via a multimodal 'fileUri' in the request parts. If a 'fileUri' part is present, you can "watch" and "listen" to the video directly. If it is NOT present, it means the video is too long or rich enough in metadata for a fast summary—in this case, use the provided Title and Description as your primary source. NEVER say "I cannot analyze video content"; always use the best available information to assist the user.
  - If PROVIDED_SOURCE_TEXT contains "[PAPER INFO]", it's an Arxiv paper. Use the Title, Authors, and Abstract provided.
  - If the user asks for a summary of the URL, use PROVIDED_SOURCE_TEXT as the basis.
  - If PROVIDED_SOURCE_TEXT is missing, very short, or you need more data (EXCEPT for YouTube), use the 'googleSearch' tool.
  - DO NOT hallucinate details not present in the source or search results.
  
  [FORMATTING & QUALITY]
  - DO NOT output internal thought processes, planning steps, or draft headers (e.g., "| Col | Col |").
  - Output ONLY the final, polished response intended for the user.
  - Ensure all Markdown syntax (tables, code blocks) is complete and valid.
  - If a table is needed, strictly follow the format: | Header | Header |\n|---|---|\n| Row | Row |.`;

    if (webContent) {
        systemInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${webContent}`;
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
                        topK: 40
                    }
                });

                for await (const chunk of result) {
                    const chunkText = chunk.text;
                    if (chunkText) {
                        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
                    }

                    const grounding = chunk.candidates?.[0]?.groundingMetadata;
                    if (grounding?.groundingChunks) {
                        const sources = grounding.groundingChunks
                            .filter((c: any) => c.web)
                            .map((c: any) => ({ title: c.web?.title || 'Source', uri: c.web?.uri || '' }))
                            .filter((s: any) => s.uri !== '');
                        if (sources.length > 0) {
                            res.write(`data: ${JSON.stringify({ sources })}\n\n`);
                        }
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
