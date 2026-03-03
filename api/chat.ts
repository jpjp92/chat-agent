import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase.js';
import { API_KEYS } from './_lib/config.js';
import { getSystemInstruction } from './_lib/agent/prompt.js';
import { compileAgentGraph } from './_lib/agent/graph.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt, history, language, attachment, attachments, webContent, session_id } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const langNames: any = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
  const currentLangCode = (language && langNames[language]) ? language : 'ko';
  const langName = langNames[currentLangCode];

  if (API_KEYS.length === 0) {
    res.write(`data: ${JSON.stringify({ error: 'No API keys found in server environment.' })}\n\n`);
    res.end();
    return;
  }

  const systemInstruction = getSystemInstruction(langName);

  // 1. Convert primitive History to LangChain Core Messages
  const contents = history
    .filter((msg: any) => msg.content && msg.content.trim() !== "" && msg.role !== 'system')
    .slice(-10)
    .map((msg: any) => msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content));

  // 2. YouTube Logic (if ytMatch, pass fileUri to Google natively)
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = prompt.match(ytRegex) || (webContent && webContent.match(ytRegex));
  const isYoutubeRequest = !!ytMatch;

  // 3. Multimodal Payload Construction for Current Request
  let humanMessageParts: any[] = [{ type: "text", text: prompt }];

  if (isYoutubeRequest) {
    const normalizedYtUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
    // In @langchain/google-genai, fileData seamlessly bridges native Gemini functions
    humanMessageParts.push({ fileData: { fileUri: normalizedYtUrl, mimeType: 'video/mp4' } });
  }

  const allAttachments = attachments && Array.isArray(attachments) ? attachments : (attachment ? [attachment] : []);
  const supportedMimeTypes = ['image/', 'video/', 'audio/', 'application/pdf'];
  const processedAttachments = [];

  for (const att of allAttachments) {
    if (att && att.data && att.mimeType) {
      const isSupported = supportedMimeTypes.some(type => att.mimeType.startsWith(type));
      if (!isSupported) continue;

      const isPublicUrl = att.data.startsWith('http');
      const isVideo = att.mimeType.startsWith('video/');
      processedAttachments.push(att); // Push to graph state for vision processing

      if (isPublicUrl && isVideo) {
        humanMessageParts.push({ fileData: { fileUri: att.data, mimeType: att.mimeType } });
      } else if (isPublicUrl) {
        try {
          const fetchRes = await fetch(att.data);
          if (fetchRes.ok) {
            const arrayBuffer = await fetchRes.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            humanMessageParts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${base64}` } });
          }
        } catch (e) { }
      } else {
        const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
        humanMessageParts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${base64Data}` } });
      }
    }
  }

  // Push User's latest constructed message
  contents.push(new HumanMessage({ content: humanMessageParts }));

  // 4. Supabase DB Save (Async Background)
  if (session_id) {
    const mainAttachment = allAttachments.length > 0 ? allAttachments[0] : null;
    supabase.from('chat_messages').insert({
      session_id,
      role: 'user',
      content: prompt,
      attachment_url: mainAttachment?.data && mainAttachment.data.startsWith('http') ? mainAttachment.data : (mainAttachment?.mimeType || null)
    }).then(({ error }) => {
      if (error) console.error('[Chat API] User message save error:', error);
    });
  }

  // 5. Build Graph Initial State
  const initialState = {
    messages: contents,
    webContent: webContent || "",
    attachments: processedAttachments,
    contextInfo: "",
    pillData: null,
    sessionId: session_id || "",
    nextNode: "router"
  };

  // 6. Execute LangGraph stream
  try {
    const graph = compileAgentGraph(systemInstruction, isYoutubeRequest);
    const stream = await graph.streamEvents(initialState, { version: "v2" });

    let fullAiResponse = '';
    const allSources: any[] = [];

    for await (const event of stream) {
      // Seamlessly map LangGraph standard stream back into legacy pure-SSE structure
      if (event.event === "on_chat_model_stream" && event.name === "ChatGoogleGenerativeAI") {
        const chunk = event.data?.chunk;
        const chunkText = chunk?.content;
        if (chunkText && typeof chunkText === 'string') {
          const sanitizedText = chunkText.replace(/ {50,}/g, '  ');
          fullAiResponse += sanitizedText;
          res.write(`data: ${JSON.stringify({ text: sanitizedText })}\n\n`);
        }

        // [CITATIONS] Grounding Metadata 추출 및 전송
        const grounding = chunk?.response_metadata?.groundingMetadata;
        if (grounding?.groundingChunks) {
          const sources = grounding.groundingChunks
            .map((gc: any) => gc.web ? { title: gc.web.title, uri: gc.web.uri } : null)
            .filter(Boolean);

          if (sources.length > 0) {
            // 중복 제거 및 누적
            sources.forEach((s: any) => {
              if (!allSources.some((existing: any) => existing.uri === s.uri)) {
                allSources.push(s);
              }
            });
            res.write(`data: ${JSON.stringify({ sources })}\n\n`);
          }
        }
      }
    }

    // 7. Supabase DB AI Response Sync
    if (fullAiResponse && session_id) {
      try {
        await supabase.from('chat_messages').insert({
          session_id,
          role: 'assistant',
          content: fullAiResponse,
          grounding_sources: allSources.length > 0 ? allSources : null
        });
        await supabase.from('chat_sessions')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', session_id);
      } catch (e) {
        console.error('[Chat API] Assistant message save error:', e);
      }
    } else if (!fullAiResponse) {
      res.write(`data: ${JSON.stringify({ error: 'LLM returned empty response.' })}\n\n`);
    }

    res.end();
    return;

  } catch (error: any) {
    console.error("[LangGraph] Execution Error:", error);
    res.write(`data: ${JSON.stringify({ error: 'LangGraph Execution Error: ' + error.message })}\n\n`);
    res.end();
  }
}
