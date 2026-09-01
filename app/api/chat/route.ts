import { NextRequest } from 'next/server';
import { createRouteClient, unauthorized, isAuthError } from '../../../lib/supabase/route';
import { GUEST_MESSAGE_LIMIT, GUEST_LIMIT_ERROR } from '../../../lib/limits';
import { getSystemInstruction } from '../../../server/agent/prompt';
import { toLangName, pickByLang, type LangName } from '../../../server/agent/lang';
import { compileAgentGraph } from '../../../server/agent/graph';
import { DEFAULT_CHAT_MODEL, isChatModelId } from '../../../server/models';
import { isDailyQuotaError, isAllKeysDailyExhausted } from '../../../server/config';
import { HumanMessage } from '@langchain/core/messages';
import { buildHistoryMessages, deriveLastTurnSearched } from '../../../server/agent/history';
import { classifyChatError } from '../../../server/chat-error-policy';
import { sanitizeActiveCards, sanitizeCardContexts } from '../../../server/agent/card-tool-output';
import { createStreamDispatch } from '../../../server/agent/stream-dispatch';

export const runtime = 'nodejs';
// 🔴 60 은 플랫폼 한계가 아니라 우리가 스스로 낮춘 값이었다 (DEV_260808 §9).
//    Hobby 플랜의 fluid compute 기본값·최대값이 **둘 다 300s** 다 — 이 줄이 없으면 300s 가 된다.
//    6.5MB PDF 가 최대 54.9s(캡의 91%)를 먹어 "가끔 끊기는" 상태였는데, 원인을 모델·전송 경로에서
//    찾다가 정작 우리가 건 제한이었음을 뒤늦게 확인했다.
//    비용: fluid 는 **Active CPU 과금**이라 Gemini 응답을 기다리는 I/O 구간은 CPU 로 안 잡힌다.
//    폭주 방지는 이 값이 아니라 generator 의 per-call 타임아웃이 담당한다.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
// 서울 리전 고정: law.go.kr 등 한국 API 접근성·지연 개선 (기본 iad1 → icn1)
export const preferredRegion = 'icn1';

const CHAT_ERRORS: Record<string, Record<string, string>> = {
  rateLimit:      { ko: '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.', en: 'Too many requests. Please try again in a moment.', es: 'Demasiadas solicitudes. Por favor, inténtelo de nuevo en un momento.', fr: 'Trop de requêtes. Veuillez réessayer dans un instant.' },
  dailyExhausted: { ko: '오늘의 API 사용량이 모두 소진되었습니다. 내일 다시 이용해주세요.', en: 'Daily API quota has been exhausted. Please try again tomorrow.', es: 'La cuota diaria de API se ha agotado. Por favor, inténtelo mañana.', fr: 'Le quota API journalier est épuisé. Veuillez réessayer demain.' },
  openAIQuota:    { ko: 'GPT 토큰 할당량이 모두 소진되었습니다. 나중에 다시 시도해주세요.', en: 'The GPT token quota has been exhausted. Please try again later.', es: 'La cuota de tokens de GPT se ha agotado. Inténtelo de nuevo más tarde.', fr: 'Le quota de jetons GPT est épuisé. Veuillez réessayer plus tard.' },
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
  const { prompt, history, language, attachment, attachments, webContent, session_id, model, timeZone, movieContext, activeCards, cardContexts } = await req.json();
  // 클라이언트 문자열을 그대로 공급자 API에 넘기지 않는다. 등록된 채팅 모델만 허용한다.
  const finalModel = isChatModelId(model) ? model : DEFAULT_CHAT_MODEL;
  const publicLang = (['ko', 'en', 'es', 'fr'].includes(language)) ? language : 'ko';

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };

      const heartbeatInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ heartbeat: true })}\n\n`)); } catch {}
      }, 8000);

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

      const humanMessageParts: any[] = [{ type: 'text', text: prompt }];
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
      const initialState = {
        messages: contents, webContent: enrichedWebContent, attachments: processedAttachments,
        contextInfo: '', pillData: null, sessionId: session_id || '',
        model: finalModel, timeZone: timeZone || 'Asia/Seoul', nextNode: 'router',
        movieContext: typeof movieContext === 'string' ? movieContext : '',
        activeCards: sanitizeActiveCards(activeCards),
        cardContexts: sanitizeCardContexts(cardContexts),
        // 직전 턴 실제 검색 여부 — 정규식 근사 대신 history의 grounding 출처를 본다(Step 6).
        lastTurnSearched: deriveLastTurnSearched(history),
      };

      const unhandledRejectionGuard = (reason: any) => {
        console.error('[Chat API] Unhandled rejection:', reason?.message ?? reason);
        try { sendEvent({ error: CHAT_ERRORS.generic[publicLang] }); } catch {}
      };
      process.once('unhandledRejection', unhandledRejectionGuard);

      try {
        const exactUrlFetchFailedMatch = enrichedWebContent.match(/\[URL_FETCH_FAILED: ([^\]\n]+)\]/);
        if (exactUrlFetchFailedMatch) {
          const failedUrl = exactUrlFetchFailedMatch[1];
          const msgs: Record<LangName, string> = {
            Korean: `해당 URL의 원문을 가져오지 못했습니다: ${failedUrl}\n\n이 URL은 보안 확인, CAPTCHA, 접근 제한 등으로 서버에서 본문을 읽을 수 없습니다.`,
            English: `I could not retrieve the exact content of this URL: ${failedUrl}\n\nThe page appears to be blocked by security verification, CAPTCHA, or access restrictions.`,
            Spanish: `No pude obtener el contenido exacto de esta URL: ${failedUrl}\n\nLa página parece estar bloqueada.`,
            French: `Je n'ai pas pu récupérer le contenu exact de cette URL : ${failedUrl}\n\nLa page semble bloquée.`,
          };
          const failMsg = pickByLang(msgs, langName);
          sendEvent({ text: failMsg });
          sendEvent({ done: true });
          if (session_id) {
            db.from('chat_messages').insert({ session_id, role: 'assistant', content: failMsg, grounding_sources: null })
            .then(({ error }) => { if (error) console.error('[Chat API] DB save failed:', error); });
          }
          return;
        }

        // 🔴 콜백도 디스패치가 만든다. 여기서 따로 만들면 `fullAiResponse` 가 둘로 갈려
        //   이미 나간 본문을 최종 메시지로 **다시** 보낸다(실측: 답변이 화면에 두 번 찍혔다).
        const dispatch = createStreamDispatch(sendEvent);
        const st = dispatch.state;
        const graph = compileAgentGraph(systemInstruction, isYoutubeRequest, dispatch.trackingEvent, langName);
        const streamEvents = await graph.streamEvents(initialState, { version: 'v2' });

        if (isYoutubeFromPrompt) {
          st.allSources.push({ title: 'YouTube Video', uri: `https://www.youtube.com/watch?v=${ytMatch![1]}` });
          sendEvent({ sources: st.allSources });
        }

        // 이벤트 → SSE 프레임 변환은 stream-dispatch.ts 가 한다. 여기 인라인이던 시절에는
        // import 가 안 돼 하니스가 루프를 못 태웠고, 이름 없는 else-if 하나가 카드 6종을
        // 삼킨 채 배포됐다 (DEV_260830 §6.14).
        for await (const event of streamEvents) dispatch.handle(event);

        const fullAiResponse = st.fullAiResponse;
        const allSources = st.allSources;

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
          console.error('[Chat API] Empty model response', {
            model: finalModel,
            status: 502,
            code: 'empty_model_response',
          });
          sendEvent({ error: CHAT_ERRORS.generic[publicLang] });
        }

        sendEvent({ done: true });

      } catch (error: any) {
        // 원문은 서버 로그에만 남긴다. UI에는 아래 화이트리스트 안내 문구만 보낸다.
        console.error('[Chat API] Model request failed', {
          model: finalModel,
          status: error?.status,
          code: error?.code,
          type: error?.type,
          name: error?.name,
          message: error?.message ?? String(error),
        });
        const errorType = classifyChatError(error, {
          geminiDailyQuota: isDailyQuotaError(error) || isAllKeysDailyExhausted(),
        });
        sendEvent({ error: CHAT_ERRORS[errorType][publicLang] });
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
