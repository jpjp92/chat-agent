import { NextRequest } from 'next/server';
import { createRouteClient, unauthorized, isAuthError } from '../../../lib/supabase/route';
import { GUEST_MESSAGE_LIMIT, GUEST_LIMIT_ERROR } from '../../../lib/limits';
import { API_KEYS } from '../../../server/config';
import { getSystemInstruction } from '../../../server/agent/prompt';
import { toLangName, pickByLang, type LangName } from '../../../server/agent/lang';
import { compileAgentGraph } from '../../../server/agent/graph';
import { DEFAULT_CHAT_MODEL } from '../../../server/models';
import { isDailyQuotaError, isAllKeysDailyExhausted } from '../../../server/config';
import { HumanMessage } from '@langchain/core/messages';
import { buildHistoryMessages } from '../../../server/agent/history';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
// 서울 리전 고정: law.go.kr 등 한국 API 접근성·지연 개선 (기본 iad1 → icn1)
export const preferredRegion = 'icn1';

const CHAT_ERRORS: Record<string, Record<string, string>> = {
  rateLimit:      { ko: '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.', en: 'Too many requests. Please try again in a moment.', es: 'Demasiadas solicitudes. Por favor, inténtelo de nuevo en un momento.', fr: 'Trop de requêtes. Veuillez réessayer dans un instant.' },
  dailyExhausted: { ko: '오늘의 API 사용량이 모두 소진되었습니다. 내일 다시 이용해주세요.', en: 'Daily API quota has been exhausted. Please try again tomorrow.', es: 'La cuota diaria de API se ha agotado. Por favor, inténtelo mañana.', fr: 'Le quota API journalier est épuisé. Veuillez réessayer demain.' },
  unavailable:    { ko: '서버가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.', en: 'Server temporarily unavailable. Please try again shortly.', es: 'Servidor temporalmente no disponible. Por favor, inténtelo de nuevo.', fr: 'Serveur temporairement indisponible. Veuillez réessayer.' },
  auth:           { ko: '인증 오류가 발생했습니다. 관리자에게 문의해주세요.', en: 'Authentication error. Please contact the administrator.', es: 'Error de autenticación. Por favor, contacte al administrador.', fr: "Erreur d'authentification. Veuillez contacter l'administrateur." },
  safety:         { ko: '안전 정책에 의해 응답이 차단되었습니다. 질문을 다르게 표현해보세요.', en: 'Response blocked by safety policy. Please rephrase your question.', es: 'Respuesta bloqueada por política de seguridad. Reformule su pregunta.', fr: 'Réponse bloquée par la politique de sécurité. Reformulez votre question.' },
  generic:        { ko: '응답 생성 중 문제가 발생했습니다. 다시 시도해주세요.', en: 'Failed to generate a response. Please try again.', es: 'Error al generar la respuesta. Por favor, inténtelo de nuevo.', fr: 'Échec de la génération de la réponse. Veuillez réessayer.' },
};

export async function POST(req: NextRequest) {
  // 스트림을 열기 전에 인증을 확인한다. SSE 는 헤더가 나간 뒤 상태코드를 바꿀 수 없다.
  // 메시지 저장은 이 user-scoped 클라이언트로만 하며, RLS 가 세션 소유권을 강제한다.
  const db = createRouteClient(req);
  if (!db) return unauthorized();

  // 게스트 횟수 제한 — LLM 을 호출하기 전에 막는다. 목적은 회원 전환이 아니라
  // 무료 키의 일일 할당량(RPD) 방어다. 소진되면 소유자 본인이 24시간 못 쓴다.
  //
  // is_guest / message_count 는 컬럼 레벨 GRANT 로 사용자가 쓸 수 없고 트리거만 기록한다.
  // message_count 는 증가 전용이라 세션을 지워도 리셋되지 않는다. 따라서 신뢰할 수 있다.
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('is_guest, message_count')
    .maybeSingle();

  if (profileError) {
    // 토큰 위조/만료(PGRST301)는 401. 그 외(마이그레이션 미적용 등)는 500 —
    // DB 에러를 401로 위장하면 원인이 인증 문제로 오인된다.
    if (isAuthError(profileError)) return unauthorized();
    console.error('[Chat API] Profile gate error:', profileError.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
  if (profile?.is_guest && (profile.message_count ?? 0) >= GUEST_MESSAGE_LIMIT) {
    return Response.json(
      { error: GUEST_LIMIT_ERROR, limit: GUEST_MESSAGE_LIMIT },
      { status: 403 },
    );
  }

  const encoder = new TextEncoder();
  const { prompt, history, language, attachment, attachments, webContent, session_id, model, timeZone, movieContext, activeCards } = await req.json();

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

      // 언어 표현 매핑은 server/agent/lang.ts 한 곳에서만 한다.
      const langName = toLangName(language);
      const systemInstruction = getSystemInstruction(langName);
      const supportedMimeTypes = ['image/', 'video/', 'audio/', 'application/pdf'];

      // 히스토리 → LangChain 메시지 (역할 표기·미디어 창 규칙은 server/agent/history.ts)
      const contents = buildHistoryMessages(history);

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
            // 이미지는 image_url(SDK가 http 이미지 fetch 지원), 그 외(영상/오디오/PDF)는 실제 mimeType을
            // 단 fileData로 — image_url로 감싸면 sdk-contents가 mime을 image/jpeg로 오추론(영상 분석 실패).
            if (att.mimeType.startsWith('image/')) humanMessageParts.push({ type: 'image_url', image_url: { url: att.data } });
            else humanMessageParts.push({ fileData: { fileUri: att.data, mimeType: att.mimeType } });
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
        db.from('chat_messages').insert({
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
        movieContext: typeof movieContext === 'string' ? movieContext : '',
        activeCards: (activeCards && typeof activeCards === 'object') ? activeCards : {},
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
          const msgs: Record<LangName, string> = {
            Korean: `해당 URL의 원문을 가져오지 못했습니다: ${failedUrl}\n\n이 URL은 보안 확인, CAPTCHA, 접근 제한 등으로 서버에서 본문을 읽을 수 없습니다.`,
            English: `I could not retrieve the exact content of this URL: ${failedUrl}\n\nThe page appears to be blocked by security verification, CAPTCHA, or access restrictions.`,
            Spanish: `No pude obtener el contenido exacto de esta URL: ${failedUrl}\n\nLa página parece estar bloqueada.`,
            French: `Je n'ai pas pu récupérer le contenu exact de cette URL : ${failedUrl}\n\nLa page semble bloquée.`,
          };
          fullAiResponse = pickByLang(msgs, langName);
          sendEvent({ text: fullAiResponse });
          sendEvent({ done: true });
          if (session_id) {
            db.from('chat_messages').insert({ session_id, role: 'assistant', content: fullAiResponse, grounding_sources: null })
            .then(({ error }) => { if (error) console.error('[Chat API] DB save failed:', error); });
          }
          return;
        }

        const trackingEvent = (data: any) => { if (data.text) fullAiResponse += data.text; sendEvent(data); };
        const graph = compileAgentGraph(systemInstruction, isYoutubeRequest, trackingEvent, langName);
        const streamEvents = await graph.streamEvents(initialState, { version: 'v2' });

        const allSources: any[] = [];
        if (isYoutubeFromPrompt) {
          allSources.push({ title: 'YouTube Video', uri: `https://www.youtube.com/watch?v=${ytMatch![1]}` });
          sendEvent({ sources: allSources });
        }

        let lcCitationBuffer = '';
        const incompletecitation = /\s?\[\d*(?:,\s*\d*)*$/;
        // sports(월드컵 순위/일정 표)는 토큰 증분 스트리밍 시 마크다운 표가 셀 단위로 실시간
        // 조립되며 어색함 → 스트리밍을 건너뛰고 generator on_chain_end에서 완성본을 한 번에 전송.
        let detectedIntent = '';

        for await (const event of streamEvents) {
          const data = event.data;
          const langGraphNode = (event as any).metadata?.langgraph_node;

          if (event.event === 'on_chat_model_stream') {
            // Only stream prose tokens from the final generation node. Nested LLM calls in
            // other nodes (vision OCR, and Gemini Vision imprint reads inside the `tools` node
            // via searchDrugInfoTool) otherwise leak their output (e.g. "JP","W") into the
            // user-facing answer ahead of the real json:drug block.
            if (langGraphNode !== 'generator') continue;
            // sports: 증분 토큰을 흘리지 않고 generator on_chain_end에서 표 전체를 한 번에 전송.
            if (detectedIntent === 'sports') continue;
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
          } else if (event.event === 'on_chain_end' && event.name === 'router') {
            // router가 정한 intent를 캡처 — generator 스트리밍보다 먼저 끝나므로 sports 게이트에 사용.
            const ri = data?.output?.intent;
            if (typeof ri === 'string') detectedIntent = ri;
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
          } else if (event.event === 'on_tool_end' && ['pharmacyTool', 'hospitalTool', 'vetTool', 'lawTool', 'movieTool', 'weatherTool'].includes(event.name)) {
            const rawOutput = data?.output;
            const toolOutput: string = typeof rawOutput === 'string' ? rawOutput : typeof rawOutput?.content === 'string' ? rawOutput.content : Array.isArray(rawOutput?.content) ? rawOutput.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '';
            const blockType = event.name === 'hospitalTool' ? 'hospital' : event.name === 'vetTool' ? 'vet' : event.name === 'lawTool' ? 'law' : event.name === 'movieTool' ? 'movie' : event.name === 'weatherTool' ? 'weather' : 'pharmacy';
            // weatherTool은 멀티 도시 시 json:weather 블록을 여러 개 반환 → 전역 매칭으로 모두 스트리밍.
            const blockMatches = toolOutput.match(new RegExp(`\`\`\`json:${blockType}\\n[\\s\\S]*?\\n\`\`\``, 'g'));
            if (blockMatches) { const jsonBlock = '\n' + blockMatches.join('\n\n') + '\n\n'; fullAiResponse += jsonBlock; sendEvent({ text: jsonBlock }); }
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
            const { error: msgError } = await db.from('chat_messages').insert({
              session_id, role: 'assistant', content: fullAiResponse,
              grounding_sources: allSources.length > 0 ? allSources : null
            });
            if (msgError) console.error('[Chat API] Assistant message save error:', msgError);
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
          error?.safetyBlock ? 'safety'
          : status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ?
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
