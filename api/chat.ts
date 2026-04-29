import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase.js';
import { API_KEYS } from './_lib/config.js';
import { getSystemInstruction } from './_lib/agent/prompt.js';
import { compileAgentGraph } from './_lib/agent/graph.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt, history, language, attachment, attachments, webContent, session_id, model, timeZone } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat: Router/Vision 실행 중 무음 구간에 연결이 끊기는 것을 방지 (모바일 프록시 드롭 방지로 8s로 단축)
  const heartbeatInterval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
  }, 8000);

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
                if (att.mimeType === 'application/pdf') {
                  parts.push({ fileData: { fileUri: att.data, mimeType: 'application/pdf' } });
                } else {
                  parts.push({ type: "image_url", image_url: { url: att.data } });
                }
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
      let isYoutubeFromPrompt = false; // true = 현재 프롬프트에 YouTube URL 포함 (신규 분석 요청)
      let ytMatch = null;

      if (promptUrls.length > 0) {
        ytMatch = promptYtMatch;
        isYoutubeRequest = !!ytMatch;
        isYoutubeFromPrompt = isYoutubeRequest;
      } else {
        // No URL in prompt — 멀티턴 컨텍스트 유지용으로만 YouTube 감지
        ytMatch = (webContent && webContent.match(ytRegex)) ||
                  (history.findLast((m: any) => m.role === 'user' && m.content.match(ytRegex))?.content?.match(ytRegex));
        isYoutubeRequest = !!ytMatch;
        isYoutubeFromPrompt = false; // 히스토리/컨텍스트에서 감지 → 영상 재전송 금지
      }

      // 3. Current Request Multimodal Payload
      let humanMessageParts: any[] = [{ type: "text", text: prompt }];

      const hasTranscript = webContent && webContent.includes('[TRANSCRIPT]');
      // VIDEO_ANALYSIS_SUMMARY = 이전 턴에서 이미 분석됨. 영상 재전송 금지.
      const hasVideoSummary = webContent && webContent.includes('[VIDEO_ANALYSIS_SUMMARY');
      // 현재 프롬프트에 YouTube URL이 있을 때만 native video 분석 — 멀티턴 follow-up은 제외
      if (isYoutubeFromPrompt && !hasTranscript && !hasVideoSummary) {
        const videoUrl = `https://www.youtube.com/watch?v=${ytMatch![1]}`;
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
            if (att.mimeType === 'application/pdf') {
              // PDF URL must use fileData format — image_url causes Gemini 500 + LangChain crash
              humanMessageParts.push({ fileData: { fileUri: att.data, mimeType: 'application/pdf' } });
            } else {
              humanMessageParts.push({ type: "image_url", image_url: { url: att.data } });
            }
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
        // Always use standard model — lite had stability issues with native video analysis
        finalModel = "gemini-2.5-flash";
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
      // Guard: LangGraph pregel errors can escape try-catch as unhandledRejection in dev
      const unhandledRejectionGuard = (reason: any) => {
        console.error('[Chat API] Unhandled rejection intercepted:', reason?.message ?? reason);
        try {
          sendEvent({ error: '응답 생성 중 문제가 발생했습니다. 다시 시도해주세요.' });
        } catch {}
      };
      process.once('unhandledRejection', unhandledRejectionGuard);

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
        // 현재 프롬프트에 YouTube URL이 있는 경우(신규 분석)만 소스 칩 + 임베드 전송
        // 멀티턴 follow-up에서는 이전 AI 응답에 이미 임베드가 표시되어 있으므로 재전송 금지
        if (isYoutubeFromPrompt) {
          const normalizedYtUrl = `https://www.youtube.com/watch?v=${ytMatch![1]}`;
          allSources.push({ title: 'YouTube Video', uri: normalizedYtUrl });
          sendEvent({ sources: allSources });
        }

        // Buffer for incomplete [N] citation split across LangChain stream chunks
        let lcCitationBuffer = '';
        const incompletecitation = /\s?\[\d*(?:,\s*\d*)*$/;

        for await (const event of streamEvents) {
          const data = event.data;

          if (event.event === "on_chat_model_stream") {
            const chunk = data?.chunk;
            const chunkText = chunk?.content;
            if (chunkText && typeof chunkText === 'string') {
              const combined = lcCitationBuffer + chunkText;
              lcCitationBuffer = '';
              let sanitizedText = combined.replace(/(.)\1{49,}/g, '$1$1$1');
              const toolCallPattern = /(?:```json\s*)?\{\s*"tool_code":\s*".*?"\s*\}(?:\s*```)?/gs;
              sanitizedText = sanitizedText.replace(toolCallPattern, '');
              // Strip complete grounding inline citations — sources shown as chips below
              sanitizedText = sanitizedText.replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '');
              // Hold back any trailing incomplete citation for the next chunk
              const incomplete = sanitizedText.match(incompletecitation);
              if (incomplete) {
                lcCitationBuffer = incomplete[0];
                sanitizedText = sanitizedText.slice(0, -lcCitationBuffer.length);
              }
              // Strip MFDS_NOT_FOUND / json:drug instruction leakage (best-effort per-chunk)
              sanitizedText = sanitizedText.replace(/`?json:drug`?\s*블록은\s*생성(?:하지\s*마세요|할\s*수\s*없습니다)[.]?\s*/g, '');
              sanitizedText = sanitizedText.replace(/\[MFDS_NOT_FOUND\][^\n]*/g, '');
              sanitizedText = sanitizedText.replace(/⚠️\s*CRITICAL INSTRUCTION:[^\n]*/g, '');

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
          } else if (event.event === "on_chain_end" && event.name === "LangGraph" && lcCitationBuffer) {
            // Flush incomplete citation buffer — stream ended so it's not a real citation
            fullAiResponse += lcCitationBuffer;
            sendEvent({ text: lcCitationBuffer });
            lcCitationBuffer = '';
          } else if (event.event === "on_chain_end" && event.name === "generator") {
            const output = data?.output;
            const modelMsg = output?.messages?.[0];

            const rawMsgText = typeof modelMsg?.content === 'string' ? modelMsg.content : '';
            const msgText = rawMsgText
              .replace(/(.)\1{49,}/g, '$1$1$1')
              // Strip MFDS_NOT_FOUND instruction leakage patterns
              .replace(/`?json:drug`?\s*블록은\s*생성(?:하지\s*마세요|할\s*수\s*없습니다)[.]?\s*/g, '')
              .replace(/\[MFDS_NOT_FOUND\][^\n]*/g, '')
              // Strip grounding inline citations
              .replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '');
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
          } else if (event.event === "on_tool_end" && (event.name === "search_web" || event.name === "search_drug_info")) {
            // Extract [WEB_SOURCE_URLS] block from searchWebTool / searchDrugInfoTool output and push to sources
            // search_drug_info embeds web search results (incl. [WEB_SOURCE_URLS]) when MFDS returns no results
            const rawOutput = data?.output;
            const toolOutput: string = typeof rawOutput === 'string'
              ? rawOutput
              : typeof rawOutput?.content === 'string'
              ? rawOutput.content
              : Array.isArray(rawOutput?.content)
              ? rawOutput.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('')
              : '';
            console.log(`[Chat API] on_tool_end "${event.name}" output type: ${typeof rawOutput}, length: ${toolOutput.length}, hasUrls: ${toolOutput.includes('[WEB_SOURCE_URLS]')}`);
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

            // Scan ToolMessages in final graph state for [WEB_SOURCE_URLS] blocks.
            // This is the reliable fallback when on_tool_end doesn't surface these.
            const finalMessages: any[] = finalOutput?.messages || [];
            for (const msg of finalMessages) {
              const msgType = msg._getType?.() ?? msg.getType?.() ?? msg.type;
              if (msgType === 'tool') {
                const content = typeof msg.content === 'string' ? msg.content : '';
                const urlBlockMatch = content.match(/\[WEB_SOURCE_URLS\]\n([\s\S]+?)(?:\n\n|$)/);
                console.log(`[Chat API] LangGraph end — ToolMessage len: ${content.length}, hasUrls: ${content.includes('[WEB_SOURCE_URLS]')}`);
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
              }
            }

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

        // 7. Supabase DB AI Response Sync
        // SSE 스트림은 이미 완료된 상태이므로 await해도 사용자 UX에 영향 없음
        // fire-and-forget은 res.end() 직후 Vercel이 함수를 freeze해 Promise가 실행 안 되는 문제 발생
        if (fullAiResponse && session_id) {
          try {
            await Promise.all([
              supabase.from('chat_messages').insert({
                session_id,
                role: 'assistant',
                content: fullAiResponse,
                grounding_sources: allSources.length > 0 ? allSources : null
              }),
              supabase.from('chat_sessions')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', session_id)
            ]).then(([{ error: msgError }, { error: sessionError }]) => {
              if (msgError) console.error('[Chat API] Assistant message save error:', msgError);
              if (sessionError) console.error('[Chat API] Session update error:', sessionError);
            });
          } catch (dbError: any) {
            console.error('[Chat API] DB save failed:', dbError.message);
          }
        } else if (!fullAiResponse) {
          sendEvent({ error: 'LLM returned empty response.' });
        }

        sendEvent({ done: true });

  } catch (error: any) {
    console.error("[LangGraph] Execution Error:", error?.status, error?.message ?? error);
    const status = error?.status ?? error?.code;
    const msg = error?.message ?? '';
    const clientMessage =
      status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
        ? '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        // 모든 API 키 소진 — 사용자 관점에서는 과부하와 동일
        : msg.includes('No API key available') || msg.includes('API keys exhausted') || msg.includes('All API keys')
        ? '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        : status === 503 || msg.includes('503') || msg.includes('UNAVAILABLE')
        ? '서버가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.'
        : status === 401 || status === 403
        ? '인증 오류가 발생했습니다. 관리자에게 문의해주세요.'
        : '응답 생성 중 문제가 발생했습니다. 다시 시도해주세요.';
    sendEvent({ error: clientMessage });
  } finally {
    clearInterval(heartbeatInterval);
    process.off('unhandledRejection', unhandledRejectionGuard);
  }

  res.end();
}
