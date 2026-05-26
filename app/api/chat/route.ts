import { NextRequest } from 'next/server';
import { supabase } from '../../../api/_lib/supabase';
import { API_KEYS } from '../../../api/_lib/config';
import { getSystemInstruction } from '../../../api/_lib/agent/prompt';
import { compileAgentGraph } from '../../../api/_lib/agent/graph';
import { DEFAULT_CHAT_MODEL } from '../../../api/_lib/models';
import { isDailyQuotaError, isAllKeysDailyExhausted } from '../../../api/_lib/config';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CHAT_ERRORS: Record<string, Record<string, string>> = {
  rateLimit:      { ko: '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.', en: 'Too many requests. Please try again in a moment.', es: 'Demasiadas solicitudes. Por favor, inténtelo de nuevo en un momento.', fr: 'Trop de requêtes. Veuillez réessayer dans un instant.' },
  dailyExhausted: { ko: '오늘의 API 사용량이 모두 소진되었습니다. 내일 다시 이용해주세요.', en: 'Daily API quota has been exhausted. Please try again tomorrow.', es: 'La cuota diaria de API se ha agotado. Por favor, inténtelo mañana.', fr: 'Le quota API journalier est épuisé. Veuillez réessayer demain.' },
  unavailable:    { ko: '서버가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.', en: 'Server temporarily unavailable. Please try again shortly.', es: 'Servidor temporalmente no disponible. Por favor, inténtelo de nuevo.', fr: 'Serveur temporairement indisponible. Veuillez réessayer.' },
  auth:           { ko: '인증 오류가 발생했습니다. 관리자에게 문의해주세요.', en: 'Authentication error. Please contact the administrator.', es: 'Error de autenticación. Por favor, contacte al administrador.', fr: "Erreur d'authentification. Veuillez contacter l'administrateur." },
  generic:        { ko: '응답 생성 중 문제가 발생했습니다. 다시 시도해주세요.', en: 'Failed to generate a response. Please try again.', es: 'Error al generar la respuesta. Por favor, inténtelo de nuevo.', fr: 'Échec de la génération de la réponse. Veuillez réessayer.' },
};

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const { prompt, history, language, attachment, attachments, webContent, session_id, model, timeZone } = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };

      const heartbeatInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ heartbeat: true })}\n\n`)); } catch {}
      }, 8000);

      if (API_KEYS.length === 0) {
        sendEvent({ error: 'No API keys found in server environment.' });
        clearInterval(heartbeatInterval);
        controller.close();
        return;
      }

      const langNames: any = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
      const currentLangCode = (language && langNames[language]) ? language : 'ko';
      const langName = langNames[currentLangCode];
      const systemInstruction = getSystemInstruction(langName);
      const supportedMimeTypes = ['image/', 'video/', 'audio/', 'application/pdf'];

      const contents = history
        .filter((msg: any) => msg.content && (msg.content.trim() !== '' || (msg.attachments && msg.attachments.length > 0)) && msg.role !== 'system')
        .slice(-10)
        .map((msg: any, index: number, array: any[]) => {
          if (msg.role === 'assistant') return new AIMessage(msg.content);
          const isRecent = index >= array.length - 3;
          const msgAttachments = msg.attachments || (msg.attachment ? [msg.attachment] : []);
          const parts: any[] = [{ type: 'text', text: msg.content || '' }];
          for (const att of msgAttachments) {
            if (att.data && att.mimeType) {
              const isSupported = supportedMimeTypes.some(t => att.mimeType.startsWith(t));
              if (!isSupported) continue;
              if (!isRecent) { parts[0].text += `\n[Attached File: ${att.fileName || att.mimeType}]`; continue; }
              const isPublicUrl = att.data.startsWith('http');
              if (isPublicUrl) {
                if (att.mimeType === 'application/pdf') parts.push({ fileData: { fileUri: att.data, mimeType: 'application/pdf' } });
                else parts.push({ type: 'image_url', image_url: { url: att.data } });
              } else {
                const b64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${b64}` } });
              }
            }
          }
          return new HumanMessage({ content: parts });
        });

      const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:shorts\/|[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
      const urlRegex = /(https?:\/\/[^\s\)]+)/g;
      const promptUrls = prompt.match(urlRegex) || [];
      const promptYtMatch = prompt.match(ytRegex);
      let isYoutubeRequest = false, isYoutubeFromPrompt = false, ytMatch = null;
      if (promptUrls.length > 0) {
        ytMatch = promptYtMatch; isYoutubeRequest = !!ytMatch; isYoutubeFromPrompt = isYoutubeRequest;
      } else {
        ytMatch = (webContent && webContent.match(ytRegex)) || (history.findLast((m: any) => m.role === 'user' && m.content.match(ytRegex))?.content?.match(ytRegex));
        isYoutubeRequest = !!ytMatch; isYoutubeFromPrompt = false;
      }

      let humanMessageParts: any[] = [{ type: 'text', text: prompt }];
      const hasTranscript = webContent && webContent.includes('[TRANSCRIPT]');
      const hasVideoSummary = webContent && webContent.includes('[VIDEO_ANALYSIS_SUMMARY');
      if (isYoutubeFromPrompt && !hasTranscript && !hasVideoSummary) {
        humanMessageParts.push({ fileData: { fileUri: `https://www.youtube.com/watch?v=${ytMatch![1]}`, mimeType: 'video/mp4' } });
      }

      const allAttachments = attachments && Array.isArray(attachments) ? attachments : (attachment ? [attachment] : []);
      const processedAttachments = [];
      for (const att of allAttachments) {
        if (att?.data && att.mimeType) {
          const isSupported = supportedMimeTypes.some(t => att.mimeType.startsWith(t));
          if (!isSupported) continue;
          processedAttachments.push(att);
          const isPublicUrl = att.data.startsWith('http');
          if (isPublicUrl) {
            if (att.mimeType === 'application/pdf') humanMessageParts.push({ fileData: { fileUri: att.data, mimeType: 'application/pdf' } });
            else humanMessageParts.push({ type: 'image_url', image_url: { url: att.data } });
          } else {
            const b64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
            humanMessageParts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${b64}` } });
          }
        }
      }
      if (humanMessageParts.length === 0) humanMessageParts.push({ type: 'text', text: prompt });
      contents.push(new HumanMessage({ content: humanMessageParts }));

      if (session_id) {
        const mainAttachment = allAttachments.length > 0 ? allAttachments[0] : null;
        supabase.from('chat_messages').insert({
          session_id, role: 'user', content: prompt,
          attachment_url: mainAttachment?.storageUrl || (mainAttachment?.data?.startsWith('http') ? mainAttachment.data : (mainAttachment?.mimeType || null))
        }).then(({ error }) => { if (error) console.error('[Chat API] User message save error:', error); });
      }

      const videoUrl = isYoutubeRequest ? `https://www.youtube.com/watch?v=${ytMatch![1]}` : '';
      const enrichedWebContent = isYoutubeRequest ? `URL: ${videoUrl}\n${webContent || ''}` : (webContent || '');
      const finalModel = model || DEFAULT_CHAT_MODEL;

      const initialState = {
        messages: contents, webContent: enrichedWebContent, attachments: processedAttachments,
        contextInfo: '', pillData: null, sessionId: session_id || '',
        model: finalModel, timeZone: timeZone || 'Asia/Seoul', nextNode: 'router',
      };

      const unhandledRejectionGuard = (reason: any) => {
        console.error('[Chat API] Unhandled rejection:', reason?.message ?? reason);
        try { sendEvent({ error: '응답 생성 중 문제가 발생했습니다. 다시 시도해주세요.' }); } catch {}
      };
      process.once('unhandledRejection', unhandledRejectionGuard);

      try {
        let fullAiResponse = '';
        const exactUrlFetchFailedMatch = enrichedWebContent.match(/\[URL_FETCH_FAILED: ([^\]\n]+)\]/);
        if (exactUrlFetchFailedMatch) {
          const failedUrl = exactUrlFetchFailedMatch[1];
          const msgs: Record<string, string> = {
            ko: `해당 URL의 원문을 가져오지 못했습니다: ${failedUrl}\n\n이 URL은 보안 확인, CAPTCHA, 접근 제한 등으로 서버에서 본문을 읽을 수 없습니다.`,
            en: `I could not retrieve the exact content of this URL: ${failedUrl}\n\nThe page appears to be blocked by security verification, CAPTCHA, or access restrictions.`,
            es: `No pude obtener el contenido exacto de esta URL: ${failedUrl}\n\nLa página parece estar bloqueada.`,
            fr: `Je n'ai pas pu récupérer le contenu exact de cette URL : ${failedUrl}\n\nLa page semble bloquée.`,
          };
          fullAiResponse = msgs[currentLangCode] ?? msgs.en;
          sendEvent({ text: fullAiResponse });
          sendEvent({ done: true });
          if (session_id) {
            Promise.all([
              supabase.from('chat_messages').insert({ session_id, role: 'assistant', content: fullAiResponse, grounding_sources: null }),
              supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', session_id)
            ]).catch((e: any) => console.error('[Chat API] DB save failed:', e?.message));
          }
          return;
        }

        const trackingEvent = (data: any) => { if (data.text) fullAiResponse += data.text; sendEvent(data); };
        const graph = compileAgentGraph(systemInstruction, isYoutubeRequest, trackingEvent);
        const streamEvents = await graph.streamEvents(initialState, { version: 'v2' });

        const allSources: any[] = [];
        if (isYoutubeFromPrompt) {
          allSources.push({ title: 'YouTube Video', uri: `https://www.youtube.com/watch?v=${ytMatch![1]}` });
          sendEvent({ sources: allSources });
        }

        let lcCitationBuffer = '';
        const incompletecitation = /\s?\[\d*(?:,\s*\d*)*$/;

        for await (const event of streamEvents) {
          const data = event.data;
          const langGraphNode = (event as any).metadata?.langgraph_node;

          if (event.event === 'on_chat_model_stream') {
            if (langGraphNode === 'vision') continue;
            const chunk = data?.chunk;
            const chunkText = chunk?.content;
            if (chunkText && typeof chunkText === 'string') {
              const combined = lcCitationBuffer + chunkText;
              lcCitationBuffer = '';
              let sanitizedText = combined.replace(/(.)\1{49,}/g, '$1$1$1');
              sanitizedText = sanitizedText.replace(/(?:```json\s*)?\{\s*"tool_code":\s*".*?"\s*\}(?:\s*```)?/gs, '');
              sanitizedText = sanitizedText.replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '');
              const incomplete = sanitizedText.match(incompletecitation);
              if (incomplete) { lcCitationBuffer = incomplete[0]; sanitizedText = sanitizedText.slice(0, -lcCitationBuffer.length); }
              sanitizedText = sanitizedText.replace(/`?json:drug`?\s*블록은\s*생성(?:하지\s*마세요|할\s*수\s*없습니다)[.]?\s*/g, '');
              sanitizedText = sanitizedText.replace(/\[MFDS_NOT_FOUND\][^\n]*/g, '');
              sanitizedText = sanitizedText.replace(/⚠️\s*CRITICAL INSTRUCTION:[^\n]*/g, '');
              if (sanitizedText.trim()) { fullAiResponse += sanitizedText; sendEvent({ text: sanitizedText }); }
            }
            const gm = chunk?.response_metadata?.groundingMetadata || chunk?.additional_kwargs?.groundingMetadata;
            if (gm?.groundingChunks) {
              const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
              if (sources.length > 0) { sources.forEach((s: any) => { if (!allSources.some((e: any) => e.uri === s.uri)) allSources.push(s); }); sendEvent({ sources: allSources }); }
            }
          } else if (event.event === 'on_chain_end' && event.name === 'LangGraph' && lcCitationBuffer) {
            fullAiResponse += lcCitationBuffer; sendEvent({ text: lcCitationBuffer }); lcCitationBuffer = '';
          } else if (event.event === 'on_chain_end' && event.name === 'generator') {
            const output = data?.output;
            const modelMsg = output?.messages?.[0];
            const rawMsgText = typeof modelMsg?.content === 'string' ? modelMsg.content : '';
            const msgText = rawMsgText.replace(/(.)\1{49,}/g, '$1$1$1').replace(/`?json:drug`?\s*블록은\s*생성(?:하지\s*마세요|할\s*수\s*없습니다)[.]?\s*/g, '').replace(/\[MFDS_NOT_FOUND\][^\n]*/g, '').replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '');
            if (msgText && !fullAiResponse) { fullAiResponse = msgText; sendEvent({ text: msgText }); }
            const gm = modelMsg?.response_metadata?.groundingMetadata || modelMsg?.additional_kwargs?.groundingMetadata;
            if (gm?.groundingChunks) {
              const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
              if (sources.length > 0) { let added = false; sources.forEach((s: any) => { if (!allSources.some((e: any) => e.uri === s.uri)) { allSources.push(s); added = true; } }); if (added) sendEvent({ sources: allSources }); }
            }
            const stateSources: any[] = output?.groundingSources || [];
            if (stateSources.length > 0) { let added = false; stateSources.forEach((s: any) => { if (s?.uri && !allSources.some((e: any) => e.uri === s.uri)) { allSources.push(s); added = true; } }); if (added) sendEvent({ sources: allSources }); }
          } else if (event.event === 'on_tool_end' && ['pharmacyTool', 'hospitalTool', 'vetTool', 'lawTool'].includes(event.name)) {
            const rawOutput = data?.output;
            const toolOutput: string = typeof rawOutput === 'string' ? rawOutput : typeof rawOutput?.content === 'string' ? rawOutput.content : Array.isArray(rawOutput?.content) ? rawOutput.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '';
            const blockType = event.name === 'hospitalTool' ? 'hospital' : event.name === 'vetTool' ? 'vet' : event.name === 'lawTool' ? 'law' : 'pharmacy';
            const jsonMatch = toolOutput.match(new RegExp(`\`\`\`json:${blockType}\\n[\\s\\S]*?\\n\`\`\``));
            if (jsonMatch) { const jsonBlock = '\n' + jsonMatch[0] + '\n\n'; fullAiResponse += jsonBlock; sendEvent({ text: jsonBlock }); }
          } else if (event.event === 'on_tool_end' && ['search_web', 'search_drug_info'].includes(event.name)) {
            const rawOutput = data?.output;
            const toolOutput: string = typeof rawOutput === 'string' ? rawOutput : typeof rawOutput?.content === 'string' ? rawOutput.content : Array.isArray(rawOutput?.content) ? rawOutput.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '';
            const urlBlockMatch = toolOutput.match(/\[WEB_SOURCE_URLS\]\n([\s\S]+?)(?:\n\n|$)/);
            if (urlBlockMatch) { let added = false; urlBlockMatch[1].split('\n').forEach((line: string) => { const [url, ...tp] = line.split(' | '); const title = tp.join(' | ').trim() || url; if (url?.startsWith('http') && !allSources.some((e: any) => e.uri === url)) { allSources.push({ title, uri: url }); added = true; } }); if (added) sendEvent({ sources: allSources }); }
          } else if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
            const finalOutput = data?.output;
            const finalMessages: any[] = finalOutput?.messages || [];
            for (const msg of finalMessages) {
              const msgType = msg._getType?.() ?? msg.getType?.() ?? msg.type;
              if (msgType === 'tool') {
                const content = typeof msg.content === 'string' ? msg.content : '';
                const urlBlockMatch = content.match(/\[WEB_SOURCE_URLS\]\n([\s\S]+?)(?:\n\n|$)/);
                if (urlBlockMatch) { let added = false; urlBlockMatch[1].split('\n').forEach((line: string) => { const [url, ...tp] = line.split(' | '); const title = tp.join(' | ').trim() || url; if (url?.startsWith('http') && !allSources.some((e: any) => e.uri === url)) { allSources.push({ title, uri: url }); added = true; } }); if (added) sendEvent({ sources: allSources }); }
              }
            }
            const finalSources: any[] = finalOutput?.groundingSources || [];
            if (finalSources.length > 0) { let added = false; finalSources.forEach((s: any) => { if (s?.uri && !allSources.some((e: any) => e.uri === s.uri)) { allSources.push(s); added = true; } }); if (added) sendEvent({ sources: allSources }); }
          }
        }

        if (fullAiResponse && session_id) {
          try {
            await Promise.all([
              supabase.from('chat_messages').insert({ session_id, role: 'assistant', content: fullAiResponse, grounding_sources: allSources.length > 0 ? allSources : null }),
              supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', session_id)
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
        console.error('[LangGraph] Execution Error:', error?.status, error?.message ?? error);
        const status = error?.status ?? error?.code;
        const msg = error?.message ?? '';
        const lang = (['ko', 'en', 'es', 'fr'].includes(language)) ? language : 'ko';
        const errorType =
          status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ?
            (isDailyQuotaError(error) || isAllKeysDailyExhausted() ? 'dailyExhausted' : 'rateLimit')
          : msg.includes('No API key available') || msg.includes('All API keys') ?
            (isAllKeysDailyExhausted() ? 'dailyExhausted' : 'rateLimit')
          : status === 503 || status === 504 || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('DEADLINE_EXCEEDED') ? 'unavailable'
          : status === 401 || status === 403 ? 'auth'
          : 'generic';
        sendEvent({ error: CHAT_ERRORS[errorType][lang] });
      } finally {
        clearInterval(heartbeatInterval);
        process.off('unhandledRejection', unhandledRejectionGuard);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
