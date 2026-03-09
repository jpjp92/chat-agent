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

  const { prompt, history, language, attachment, attachments, webContent, session_id, model, timeZone } = req.body;

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
  const supportedMimeTypes = ['image/', 'video/', 'audio/', 'application/pdf'];

  // 1. Convert primitive History to LangChain Core Messages with Multimodal Support
  // Optimization: Only include multimodal binaries for the LAST 3 turns to prevent payload bloating and Vercel timeouts.
  const contents = history
    .filter((msg: any) => msg.content && (msg.content.trim() !== "" || (msg.attachments && msg.attachments.length > 0)) && msg.role !== 'system')
    .slice(-10)
    .map((msg: any, index: number, array: any[]) => {
      if (msg.role === 'assistant') return new AIMessage(msg.content);
      
      const isRecent = index >= array.length - 3;
      const parts: any[] = [{ type: "text", text: msg.content || "" }];
      const msgAttachments = msg.attachments || (msg.attachment ? [msg.attachment] : []);
      
      for (const att of msgAttachments) {
        if (att.data && att.mimeType) {
          const isSupported = supportedMimeTypes.some(type => att.mimeType.startsWith(type));
          if (!isSupported) continue;

          // For older history turns, just provide a text indicator to save bandwidth/time
          if (!isRecent) {
             parts[0].text += `\n[Attached File: ${att.fileName || att.mimeType}]`;
             continue;
          }

          const isPublicUrl = att.data.startsWith('http');
          if (isPublicUrl) {
            parts.push({ type: "image_url", image_url: { url: att.data } });
          } else {
            const base64Content = att.data.includes(',') ? att.data.split(',')[1] : att.data;
            parts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${base64Content}` } });
          }
        }
      }
      return new HumanMessage({ content: parts });
    });

  // 2. YouTube Logic (Detection only, rely on webContent for summary)
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = prompt.match(ytRegex) || (webContent && webContent.match(ytRegex)) || (history.some((m: any) => m.role === 'user' && m.content.match(ytRegex)));
  const isYoutubeRequest = !!ytMatch;

  // 3. Current Request Multimodal Payload
  let humanMessageParts: any[] = [{ type: "text", text: prompt }];

  // v4.10 Hybrid YouTube Logic:
  // If no transcript was found (webContent is empty or error), restore direct video analysis (fileData)
  // This allows Gemini to "watch" the video even when text extraction fails.
  const hasTranscript = webContent && webContent.includes('[YOUTUBE_VIDEO_INFO]') && !webContent.includes('[FETCH_ERROR');
  if (isYoutubeRequest && !hasTranscript) {
    const videoUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
    // Using fileData bridges the gap when transcripts are missing.
    humanMessageParts.push({ fileData: { fileUri: videoUrl, mimeType: 'video/mp4' } });
    console.log('[Chat API] No transcript found. Falling back to Native Video Analysis (fileData).');
  }

  const allAttachments = attachments && Array.isArray(attachments) ? attachments : (attachment ? [attachment] : []);
  const processedAttachments = [];

  for (const att of allAttachments) {
    if (att && att.data && att.mimeType) {
      const isSupported = supportedMimeTypes.some(type => att.mimeType.startsWith(type));
      if (!isSupported) continue;

      const isPublicUrl = att.data.startsWith('http');
      processedAttachments.push(att); // Push to graph state for vision processing

      if (isPublicUrl) {
        // Pass URL; Generator Node will handle fetching/rendering based on mimeType
        humanMessageParts.push({ type: "image_url", image_url: { url: att.data } });
      } else {
        const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
        humanMessageParts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${base64Data}` } });
      }
    }
  }

  // Final validation of parts to avoid empty content errors
  if (humanMessageParts.length === 0) humanMessageParts.push({ type: "text", text: prompt });
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
  const videoUrl = isYoutubeRequest ? `https://www.youtube.com/watch?v=${ytMatch[1]}` : "";
  const enrichedWebContent = isYoutubeRequest ? `URL: ${videoUrl}\n${webContent || ""}` : (webContent || "");

  const initialState = {
    messages: contents,
    webContent: enrichedWebContent,
    attachments: processedAttachments,
    contextInfo: "",
    pillData: null,
    sessionId: session_id || "",
    model: model || "gemini-2.5-flash",
    timeZone: timeZone || "Asia/Seoul",
    nextNode: "router"
  };

  // 6. Execute LangGraph stream
  try {
    const graph = compileAgentGraph(systemInstruction, isYoutubeRequest);
    const stream = await graph.streamEvents(initialState, { version: "v2" });

    let fullAiResponse = '';
    const allSources: any[] = [];
    if (isYoutubeRequest) {
      const normalizedYtUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
      allSources.push({ title: 'YouTube Video', uri: normalizedYtUrl });
      res.write(`data: ${JSON.stringify({ sources: allSources })}\n\n`);
    }

    for await (const event of stream) {
      console.log(`[SSE Debug] ${event.event} | ${event.name}`);
      const data = event.data;

      if (event.event === "on_chat_model_stream") {
        const chunk = data?.chunk;
        const chunkText = chunk?.content;
        if (chunkText && typeof chunkText === 'string') {
          // Sanitization: Collapse 50+ repeated characters (hallucination or formatting bug)
          const sanitizedText = chunkText.replace(/(.)\1{49,}/g, '$1$1$1');
          fullAiResponse += sanitizedText;
          res.write(`data: ${JSON.stringify({ text: sanitizedText })}\n\n`);
        }
        // 스트림 메타데이터 탐색
        const gm = chunk?.response_metadata?.groundingMetadata || chunk?.additional_kwargs?.groundingMetadata;
        if (gm?.groundingChunks) {
          const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
          if (sources.length > 0) {
            sources.forEach((s: any) => { if (!allSources.some((e: any) => e.uri === s.uri)) { allSources.push(s); console.log(`[Chat API] Found source in STREAM: ${s.title}`); } });
            res.write(`data: ${JSON.stringify({ sources: allSources })}\n\n`);
          }
        }
      } else if (event.event === "on_chat_model_end" && event.name === "ChatGoogleGenerativeAI") {
        const out = data?.output;
        const gm = out?.response_metadata?.groundingMetadata || out?.additional_kwargs?.groundingMetadata;
        if (gm) console.log(`[Chat API] Found GroundingMetadata in Model End!`);
      } else if (event.event === "on_chain_end" && event.name === "generator") {
        const output = data?.output;
        const modelMsg = output?.messages?.[0];

        // SDK path: text wasn't streamed via on_chat_model_stream, send it now
        const rawMsgText = typeof modelMsg?.content === 'string' ? modelMsg.content : '';
        const msgText = rawMsgText.replace(/(.)\1{49,}/g, '$1$1$1');
        if (msgText && !fullAiResponse) {
          fullAiResponse = msgText;
          res.write(`data: ${JSON.stringify({ text: msgText })}\n\n`);
          console.log('[Chat API] Sent text from SDK generator path.');
        }

        const gm = modelMsg?.response_metadata?.groundingMetadata || modelMsg?.additional_kwargs?.groundingMetadata;

        if (gm?.groundingChunks) {
          const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
          if (sources.length > 0) {
            let addedNew = false;
            sources.forEach((s: any) => {
              if (!allSources.some((e: any) => e.uri === s.uri)) {
                allSources.push(s);
                addedNew = true;
                console.log(`[Chat API] Found source in CHAIN_END: ${s.title}`);
              }
            });
            if (addedNew) res.write(`data: ${JSON.stringify({ sources: allSources })}\n\n`);
          }
        }

        // Also check groundingSources stored directly in LangGraph state by generator node (@google/genai SDK path)
        const stateSources: any[] = output?.groundingSources || [];
        if (stateSources.length > 0) {
          let addedNew = false;
          stateSources.forEach((s: any) => {
            if (s?.uri && !allSources.some((e: any) => e.uri === s.uri)) {
              allSources.push(s);
              addedNew = true;
              console.log(`[Chat API] Found source via SDK state: ${s.title || s.uri}`);
            }
          });
          if (addedNew) res.write(`data: ${JSON.stringify({ sources: allSources })}\n\n`);
        }
      } else if (event.event === "on_chain_end" && event.name === "LangGraph") {
        // Final state check: pick up groundingSources from the overall graph output
        const finalOutput = data?.output;
        const finalSources: any[] = finalOutput?.groundingSources || [];
        if (finalSources.length > 0) {
          let addedNew = false;
          finalSources.forEach((s: any) => {
            if (s?.uri && !allSources.some((e: any) => e.uri === s.uri)) {
              allSources.push(s);
              addedNew = true;
              console.log(`[Chat API] Found source in final LangGraph output: ${s.title || s.uri}`);
            }
          });
          if (addedNew) res.write(`data: ${JSON.stringify({ sources: allSources })}\n\n`);
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
