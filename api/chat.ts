import type { VercelRequest, VercelResponse } from '@vercel/node';
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

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat: Router/Vision 실행 중 무음 구간에 연결이 끊기는 것을 방지
  const heartbeatInterval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
  }, 15000);

  if (API_KEYS.length === 0) {
        sendEvent({ error: 'No API keys found in server environment.' });
        res.end();
        return;
      }

      const langNames: any = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
      const currentLangCode = (language && langNames[language]) ? language : 'ko';
      const langName = langNames[currentLangCode];
      
      const systemInstruction = getSystemInstruction(langName);
      const supportedMimeTypes = ['image/', 'video/', 'audio/', 'application/pdf'];

      // 1. Convert primitive History to LangChain Core Messages with Multimodal Support
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
      const urlRegex = /(https?:\/\/[^\s\)]+)/g;

      const promptUrls = prompt.match(urlRegex) || [];
      const promptYtMatch = prompt.match(ytRegex);

      let isYoutubeRequest = false;
      let ytMatch = null;

      if (promptUrls.length > 0) {
        // If there are URLs in the current prompt, only consider it a YouTube request if it's a YouTube URL.
        ytMatch = promptYtMatch;
        isYoutubeRequest = !!ytMatch;
      } else {
        // No URL in prompt, check previous context (webContent or history)
        ytMatch = (webContent && webContent.match(ytRegex)) || 
                  (history.findLast((m: any) => m.role === 'user' && m.content.match(ytRegex))?.content?.match(ytRegex));
        isYoutubeRequest = !!ytMatch;
      }

      // 3. Current Request Multimodal Payload
      let humanMessageParts: any[] = [{ type: "text", text: prompt }];

      const hasTranscript = webContent && webContent.includes('[TRANSCRIPT]');
      if (isYoutubeRequest && !hasTranscript) {
        const videoUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
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
            humanMessageParts.push({ type: "image_url", image_url: { url: att.data } });
          } else {
            const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
            humanMessageParts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${base64Data}` } });
          }
        }
      }

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

      let finalModel = model;
      if (!finalModel) {
        // Use Lite for YouTube Vision (for speed) and Standard 2.5 Flash for others (for intelligence)
        finalModel = (isYoutubeRequest && !hasTranscript) ? "gemini-2.5-flash-lite" : "gemini-2.5-flash";
      }

      const initialState = {
        messages: contents,
        webContent: enrichedWebContent,
        attachments: processedAttachments,
        contextInfo: "",
        pillData: null,
        sessionId: session_id || "",
        model: finalModel,
        timeZone: timeZone || "Asia/Seoul",
        nextNode: "router"
      };

      // 6. Execute LangGraph stream
      try {
        let fullAiResponse = '';
        // trackingEvent: generator.ts에서 SDK 스트리밍 청크를 보낼 때 fullAiResponse도 자동 누적
        const trackingEvent = (data: any) => {
          if (data.text) fullAiResponse += data.text;
          sendEvent(data);
        };
        const graph = compileAgentGraph(systemInstruction, isYoutubeRequest, trackingEvent);
        const streamEvents = await graph.streamEvents(initialState, { version: "v2" });

        const allSources: any[] = [];
        if (isYoutubeRequest) {
          const normalizedYtUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
          allSources.push({ title: 'YouTube Video', uri: normalizedYtUrl });
          sendEvent({ sources: allSources });
        }

        for await (const event of streamEvents) {
          const data = event.data;

          if (event.event === "on_chat_model_stream") {
            const chunk = data?.chunk;
            const chunkText = chunk?.content;
            if (chunkText && typeof chunkText === 'string') {
              let sanitizedText = chunkText.replace(/(.)\1{49,}/g, '$1$1$1');
              const toolCallPattern = /(?:```json\s*)?\{\s*"tool_code":\s*".*?"\s*\}(?:\s*```)?/gs;
              sanitizedText = sanitizedText.replace(toolCallPattern, '');
              
              if (sanitizedText.trim()) {
                fullAiResponse += sanitizedText;
                sendEvent({ text: sanitizedText });
              }
            }
            const gm = chunk?.response_metadata?.groundingMetadata || chunk?.additional_kwargs?.groundingMetadata;
            if (gm?.groundingChunks) {
              const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
              if (sources.length > 0) {
                sources.forEach((s: any) => { if (!allSources.some((e: any) => e.uri === s.uri)) { allSources.push(s); } });
                sendEvent({ sources: allSources });
              }
            }
          } else if (event.event === "on_chain_end" && event.name === "generator") {
            const output = data?.output;
            const modelMsg = output?.messages?.[0];

            const rawMsgText = typeof modelMsg?.content === 'string' ? modelMsg.content : '';
            const msgText = rawMsgText.replace(/(.)\1{49,}/g, '$1$1$1');
            // SDK 스트리밍 경로: trackingEvent로 청크가 이미 전송됨 → fullAiResponse에 누적됨
            // LangChain 경로: on_chat_model_stream으로 이미 전송됨
            // fallback: 아무것도 누적되지 않은 경우 (예: 빈 응답 또는 예외 경로)
            if (msgText && !fullAiResponse) {
              fullAiResponse = msgText;
              sendEvent({ text: msgText });
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
                  }
                });
                if (addedNew) sendEvent({ sources: allSources });
              }
            }

            const stateSources: any[] = output?.groundingSources || [];
            if (stateSources.length > 0) {
              let addedNew = false;
              stateSources.forEach((s: any) => {
                if (s?.uri && !allSources.some((e: any) => e.uri === s.uri)) {
                  allSources.push(s);
                  addedNew = true;
                }
              });
              if (addedNew) sendEvent({ sources: allSources });
            }
          } else if (event.event === "on_tool_end" && event.name === "search_web") {
            // Extract [WEB_SOURCE_URLS] block from searchWebTool output and push to sources
            const toolOutput: string = typeof data?.output === 'string' ? data.output : '';
            const urlBlockMatch = toolOutput.match(/\[WEB_SOURCE_URLS\]\n([\s\S]+?)(?:\n\n|$)/);
            if (urlBlockMatch) {
              let addedNew = false;
              urlBlockMatch[1].split('\n').forEach((line: string) => {
                const [url, ...titleParts] = line.split(' | ');
                const title = titleParts.join(' | ').trim() || url;
                if (url?.startsWith('http') && !allSources.some((e: any) => e.uri === url)) {
                  allSources.push({ title, uri: url });
                  addedNew = true;
                }
              });
              if (addedNew) sendEvent({ sources: allSources });
            }
          } else if (event.event === "on_chain_end" && event.name === "LangGraph") {
            const finalOutput = data?.output;
            const finalSources: any[] = finalOutput?.groundingSources || [];
            if (finalSources.length > 0) {
              let addedNew = false;
              finalSources.forEach((s: any) => {
                if (s?.uri && !allSources.some((e: any) => e.uri === s.uri)) {
                  allSources.push(s);
                  addedNew = true;
                }
              });
              if (addedNew) sendEvent({ sources: allSources });
            }
          }
        }

        // 7. Supabase DB AI Response Sync (fire-and-forget — res.end() 전에 await하지 않음)
        if (fullAiResponse && session_id) {
          supabase.from('chat_messages').insert({
            session_id,
            role: 'assistant',
            content: fullAiResponse,
            grounding_sources: allSources.length > 0 ? allSources : null
          }).then(({ error }) => {
            if (error) console.error('[Chat API] Assistant message save error:', error);
          });
          supabase.from('chat_sessions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', session_id)
            .then(({ error }) => {
              if (error) console.error('[Chat API] Session update error:', error);
            });
        } else if (!fullAiResponse) {
          sendEvent({ error: 'LLM returned empty response.' });
        }

  } catch (error: any) {
    console.error("[LangGraph] Execution Error:", error);
    sendEvent({ error: 'LangGraph Execution Error: ' + error.message });
  } finally {
    clearInterval(heartbeatInterval);
  }

  res.end();
}
