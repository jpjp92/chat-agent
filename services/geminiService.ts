import { Role, Message, MessageAttachment, Language, GroundingSource } from "../types";
import { getAccessToken } from "../lib/supabase/client";
import { GUEST_LIMIT_ERROR } from "../lib/limits";
import { DEFAULT_CHAT_MODEL } from "../src/lib/models";

/** 게스트 메시지 한도 초과. 호출부가 토스트 대신 로그인 모달을 띄우도록 구분한다. */
export class GuestLimitError extends Error {
  constructor() {
    super(GUEST_LIMIT_ERROR);
    this.name = 'GuestLimitError';
  }
}

/** 서버가 사용자에게 공개하도록 정제한 채팅 오류만 이 타입으로 전달한다. */
export class UserFacingChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingChatError';
  }
}

const CHAT_REQUEST_FAILED: Record<Language, string> = {
  ko: '응답 생성 중 문제가 발생했습니다. 다시 시도해주세요.',
  en: 'Failed to generate a response. Please try again.',
  es: 'Error al generar la respuesta. Por favor, inténtelo de nuevo.',
  fr: 'Échec de la génération de la réponse. Veuillez réessayer.',
};

let sharedAudioContext: AudioContext | null = null;

/**
 * 인증이 필요한 API 호출 — 매 요청마다 현재 access token 을 붙인다.
 *
 * 토큰을 모듈 로드 시점에 캡처해두면 만료(기본 1시간) 후 조용히 401 이 난다.
 * getAccessToken() 은 호출 시점의 세션을 읽으므로 supabase-js 가 갱신해둔 토큰을 쓴다.
 *
 * 세션이 아직 없으면(익명 로그인 진행 중) 던진다 — 토큰 없이 보내 401 을 받고
 * "네트워크 오류"로 오해하는 것보다 낫다. 호출부는 currentUser 게이트로 막는다.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');
  return fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

export const uploadToStorage = async (file: { fileName: string; data: string; mimeType: string }, bucket: string) => {
  try {
    // 1. Get Signed Upload URL from backend
    const signRes = await authedFetch('/api/create-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.fileName,
        bucket: bucket,
        mimeType: file.mimeType
      })
    });

    if (!signRes.ok) {
      const errorData = await signRes.json();
      throw new Error(errorData.error || 'Failed to generate signed URL');
    }

    const { signedUrl, publicUrl, filePath } = await signRes.json();

    // 2. Upload binary data directly to the signed URL using PUT
    const buffer = decodeBase64(file.data);
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.mimeType,
        'x-upsert': 'true' // Supabase specific header if needed, but createsigneduploadurl usually handles it
      },
      body: buffer as any
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.error('[Frontend Upload] PUT failed:', errorText);
      throw new Error('Direct upload to signed URL failed');
    }

    return { url: publicUrl, filePath: filePath };

  } catch (error: any) {
    console.error('[Frontend Upload] Error:', error);
    throw new Error(error.message || 'Upload failed');
  }
};
/**
 * 세션 관리
 */
// user_id 는 더 이상 보내지 않는다 — 서버가 Bearer 토큰의 auth.uid() 로 스코프한다.
export const fetchSessions = async (offset = 0, limit = 30) => {
  let response: Response;
  try {
    response = await authedFetch(`/api/sessions?offset=${offset}&limit=${limit}`);
  } catch (networkErr: any) {
    throw new Error(`Sessions network error: ${networkErr?.message ?? 'fetch failed'}`);
  }
  if (!response.ok) throw new Error(`Failed to fetch sessions: ${response.status}`);
  return response.json();
};

export const createSession = async (title?: string) => {
  // user_id 미전달 — DB 의 `default auth.uid()` 가 채운다.
  const response = await authedFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  if (!response.ok) throw new Error(`Failed to create session: ${response.status}`);
  return response.json();
};

export const fetchSessionMessages = async (sessionId: string) => {
  const response = await authedFetch(`/api/sessions?session_id=${sessionId}`);
  return response.json();
};

export const deleteSession = async (sessionId: string) => {
  const response = await authedFetch('/api/sessions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId })
  });
  if (!response.ok) throw new Error(`Failed to delete session: ${response.status}`);
  return response.json();
};

export const updateSessionTitle = async (sessionId: string, title: string) => {
  const response = await authedFetch('/api/sessions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, title })
  });
  if (!response.ok) throw new Error(`Failed to update session title: ${response.status}`);
  return response.json();
};

/**
 * URL에서 직접 텍스트 또는 파일을 추출 (백엔드 프록시 이용)
 */
export const fetchUrlData = async (url: string): Promise<{ isPdf?: boolean, content: string }> => {
  const controller = new AbortController();
  // 65초: Brunch direct 최대 10s + OpenAI URL 추출 최대 45s + 네트워크 여유.
  // 성공 결과는 url_cache에 저장되므로 이후 요청은 즉시 반환된다.
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    const data = await response.json();
    return { isPdf: data.isPdf, content: data.content || "" };
  } catch (error) {
    console.warn("Direct scraping failed", error);
    return { isPdf: false, content: "" };
  } finally {
    clearTimeout(timeout);
  }
};



function decodeBase64(base64: string): Uint8Array {
  try {
    const binaryString = atob(base64.includes(',') ? base64.split(',')[1] : base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Base64 decoding failed:", e);
    return new Uint8Array();
  }
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const summarizeConversation = async (history: Message[], language: Language = 'ko'): Promise<string> => {
  try {
    const response = await fetch('/api/summarize-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, language })
    });
    const data = await response.json();
    return data.title || "New Chat";
  } catch (error) {
    return "New Chat";
  }
};

export const streamChatResponse = async (
  prompt: string,
  history: Message[],
  onChunk: (chunk: string, isReset: boolean) => void,
  language: Language = 'ko',
  attachment?: MessageAttachment,
  webContent?: string,
  contentType: 'text' | 'web' | 'video' = 'text',
  onMetadata?: (sources: GroundingSource[]) => void,
  sessionId?: string,
  attachments?: MessageAttachment[],
  // 기본값은 레지스트리에서 가져온다 — 리터럴이면 기본 모델이 바뀔 때 조용히 뒤처진다
  // (실제로 기본이 3.6 이 된 뒤에도 여기만 3.5 로 남아 있었다). 호출부가 항상 넘기므로 동작 변화는 없다.
  model: string = DEFAULT_CHAT_MODEL,
  onCutOff?: () => void,
  movieContext?: string,
  // 화면에 떠 있는 카드 종류. 서버는 최근 10개 메시지만 받아서 카드 존재를 추정하는데,
  // 대화가 5턴만 지나면 카드가 그 창 밖으로 밀려 "카드 없음"이 된다(영어 멀티턴에서 실측:
  // 카드 이후 6턴째부터 후속 판정 블록이 통째로 스킵됐다). 전체 히스토리를 가진 클라이언트가
  // 판정해서 넘긴다 — movieContext가 이미 쓰던 방식과 같은 패턴.
  activeCards?: { weather?: boolean; paper?: boolean; pharmacy?: boolean; hospital?: boolean; vet?: boolean; law?: boolean; latest?: 'pharmacy' | 'hospital' | 'vet' | 'law' },
  cardContexts?: Partial<Record<'pharmacy' | 'hospital' | 'vet' | 'law', string>>,
) => {
  const controller = new AbortController();
  let lastActivity = Date.now();
  // 25s = heartbeat 8s × 3회 미수신 시 연결 드롭으로 간주
  const ACTIVITY_TIMEOUT = 25000;

  const activityMonitor = setInterval(() => {
    if (Date.now() - lastActivity > ACTIVITY_TIMEOUT) {
      clearInterval(activityMonitor);
      console.warn('[SSE] No activity for 25s — aborting stale connection');
      controller.abort();
    }
  }, 5000);

  let receivedAnyText = false;
  let receivedDone = false;

  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // ── 요청 본문 다이어트 (413 Payload Too Large 대응) ──────────────────────────
    // 413은 일시적 오류가 아니라 플랫폼이 본문 크기로 요청을 거부하는 것 → 같은 대화에서 계속 재현된다.
    // 누적 원인: ① 세션 전체 히스토리를 매 턴 전송(서버는 수신 후에야 slice(-10)) ② 첨부의 base64가
    // 히스토리에 남아 매 턴 재전송(이미지는 업로드 후에도 data에 base64 유지 · 1MB 미만 문서는 inline).
    // 서버는 최근 3턴 밖 첨부를 `[Attached File: …]` 라벨로만 쓰므로(route.ts) 그 base64는 보내도 버려진다.
    const HISTORY_LIMIT = 10;      // route.ts 의 slice(-10) 와 동일
    const KEEP_MEDIA_LAST = 6;     // route.ts 의 isRecent(최근 3) 보다 넉넉히 — 필터 차이로 인한 오절단 방지
    const MAX_BODY_BYTES = 4_400_000; // Vercel 요청 본문 한도(4.5MB) 직전에서 선차단

    const trimmedHistory = history
      .filter(msg => msg.role !== 'system' && (msg.content?.trim() !== '' || (msg.attachments && msg.attachments.length > 0)))
      .slice(-HISTORY_LIMIT);

    const sanitizeAttachment = (att: any, keepMedia: boolean) => {
      if (!att) return att;
      // extractedText 는 webContent 로 따로 가므로 항상 제거(중복 페이로드)
      const { extractedText: _et, ...rest } = att;
      const isInlineBase64 = typeof rest.data === 'string' && rest.data.length > 0 && !rest.data.startsWith('http');
      if (!isInlineBase64) return rest;
      // 업로드된 사본이 있으면 base64 대신 URL 로 — 서버가 URL 을 그대로 처리하므로 기능 동일
      if (rest.storageUrl) return { ...rest, data: rest.storageUrl };
      // 최근 창 밖이면 서버가 라벨로만 쓰므로 본문 제거(truthy 유지 → 라벨은 그대로 붙는다)
      if (!keepMedia) return { ...rest, data: '[omitted:history]' };
      return rest;
    };

    const sanitizedHistory = trimmedHistory.map((msg, i) => {
      const keepMedia = i >= trimmedHistory.length - KEEP_MEDIA_LAST;
      return {
        ...msg,
        attachment: sanitizeAttachment(msg.attachment, keepMedia),
        attachments: msg.attachments?.map(att => sanitizeAttachment(att, keepMedia)),
      };
    });

    const body = JSON.stringify({ prompt, history: sanitizedHistory, language, attachment, webContent, session_id: sessionId, attachments, model, timeZone, movieContext, activeCards, cardContexts });
    const bodyBytes = new TextEncoder().encode(body).length;
    if (bodyBytes > 1_000_000) {
      // 어떤 요소가 본문을 키웠는지 확정용 계측 — 413 재발 시 이 로그로 범인을 특정한다.
      const size = (v: any) => (v ? new TextEncoder().encode(JSON.stringify(v)).length : 0);
      console.warn('[chat] large payload', {
        totalKB: Math.round(bodyBytes / 1024),
        historyKB: Math.round(size(sanitizedHistory) / 1024),
        attachmentsKB: Math.round(size(attachments) / 1024),
        webContentKB: Math.round(size(webContent) / 1024),
        historyMsgs: sanitizedHistory.length,
      });
    }
    if (bodyBytes > MAX_BODY_BYTES) {
      // 413 은 서버 코드에 닿기 전에 거부되므로 여기서 사람이 읽을 수 있는 안내로 대체한다.
      throw new UserFacingChatError(`요청이 너무 큽니다 (${(bodyBytes / 1024 / 1024).toFixed(1)}MB). 첨부 파일 크기를 줄이거나 새 대화에서 다시 시도해주세요.`);
    }

    const response = await authedFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      try {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const errorData = await response.json();
          // 게스트 횟수 초과는 에러 토스트가 아니라 로그인 유도로 이어져야 한다.
          if (errorData.error === GUEST_LIMIT_ERROR) throw new GuestLimitError();
        }
      } catch (e) {
        if (e instanceof GuestLimitError) throw e;
      }
      console.error('[Chat API] Non-success response hidden from UI', { status: response.status });
      throw new UserFacingChatError(CHAT_REQUEST_FAILED[language] || CHAT_REQUEST_FAILED.ko);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lastActivity = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          let data: any;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            // 모바일 네트워크 불안정으로 깨진 SSE 청크 → 무시하고 계속
            console.warn('[SSE] Malformed chunk skipped:', line.slice(6, 60));
            continue;
          }
          if (data.heartbeat) continue;
          if (data.done) { receivedDone = true; continue; }
          if (data.cutOff && onCutOff) { onCutOff(); continue; }
          // /api/chat은 공급자 원문 대신 화이트리스트 메시지만 보낸다.
          if (data.error) throw new UserFacingChatError(data.error);
          if (data.text) { onChunk(data.text, false); receivedAnyText = true; }
          if (data.sources && onMetadata) onMetadata(data.sources);
        }
      }
    }

    if (!receivedAnyText) {
      // cold start / Vercel 타임아웃 → 재시도 가능
      throw new Error('응답을 받지 못했습니다. 다시 시도해주세요.');
    }

    // 부분 응답 수신 후 done 없이 종료 → 연결 드롭 → amber 배너
    if (!receivedDone && onCutOff) {
      console.warn('[SSE] Stream ended without done event — partial response (connection drop)');
      onCutOff();
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // activityMonitor가 25s 무활동으로 중단 → 재시도 가능 에러로 변환
      throw new Error('응답을 받지 못했습니다. 다시 시도해주세요.');
    }
    // 모바일 네트워크 드롭: 부분 텍스트를 이미 받은 경우 amber 배너 표시 후 조용히 종료
    // reader.read() 예외 시 try 블록의 !receivedDone 체크가 건너뛰어지는 문제 보완
    if (receivedAnyText && onCutOff) {
      console.warn('[SSE] Network error after partial response — showing cutOff banner', error.message);
      onCutOff();
      return;
    }
    // 게스트 한도 초과는 실패가 아니라 정상 전환 신호다. 콘솔을 시끄럽게 하지 않고
    // 그대로 전파해 useChatStream 이 로그인 모달을 띄우게 한다.
    if (error instanceof GuestLimitError) throw error;
    console.error("Chat streaming failed", error);
    throw error;
  } finally {
    clearInterval(activityMonitor);
  }
};

/**
 * 진행 중인 TTS 재생 — 요청 취소용 AbortController 와 예약된 소스들.
 * 재생 버튼을 다시 누르거나 다른 메시지를 재생하면 둘 다 즉시 멈춘다.
 */
/**
 * TTS 실패를 **사용자 안내 종류**로 분류한다. 호출부는 kind 로 문구만 고르고 상태 코드·원문은 보여주지 않는다.
 *   guest   — 게스트(로그인 필요, 403)
 *   quota   — 회원 일일 한도 초과(429)
 *   auth    — 세션 없음·만료(401, authedFetch 토큰 없음)
 *   network — 서버에 닿지 못함(오프라인 등)
 *   server  — 그 밖의 실패(500 등)
 * 원인(status·원문)은 `detail` 에만 담아 콘솔로 남긴다.
 */
export type TtsErrorKind = 'guest' | 'quota' | 'auth' | 'network' | 'server';
export class TtsError extends Error {
  constructor(public kind: TtsErrorKind, public detail?: string) {
    super(`TTS ${kind}${detail ? `: ${detail}` : ''}`);
    this.name = 'TtsError';
  }
}

let currentPlayback: { abort: AbortController; sources: Set<AudioBufferSourceNode> } | null = null;

export const stopAudio = () => {
  if (!currentPlayback) return;
  currentPlayback.abort.abort();
  for (const s of currentPlayback.sources) {
    try { s.stop(); } catch (e) { }
  }
  currentPlayback = null;
};

/**
 * 모바일 브라우저의 오디오 잠금 해제를 위해 사용자 제스처(클릭) 직후 호출
 */
export const initAudioContext = async () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  if (sharedAudioContext.state === 'suspended') {
    await sharedAudioContext.resume();
  }

  // 아주 짧은 무음 버퍼를 재생하여 채널을 확실히 점유 (Unlock)
  const silentBuffer = sharedAudioContext.createBuffer(1, 1, 24000);
  const source = sharedAudioContext.createBufferSource();
  source.buffer = silentBuffer;
  source.connect(sharedAudioContext.destination);
  source.start();
  source.stop();
};

/**
 * 첫 재생을 늦춰 두는 여유(지터 버퍼). 🔴 OpenAI 는 첫 ~0.4s 분량을 몰아 보낸 뒤 **최대 225ms 멈췄다가**
 * 이어 보낸다(2026-10-03 실측 3/3) — 바로 재생하면 시작 직후 한 번 끊긴다. Gemini 는 끊김 0 이었다.
 */
const TTS_START_LEAD_SEC: Record<string, number> = { gemini: 0.05, openai: 0.3 };
/** 예약 단위 ≈ 0.2s(24kHz·16bit = 48,000 B/s). 첫 소리는 이만큼 모인 뒤 시작한다. */
const TTS_SCHEDULE_MIN_BYTES = 9_600;

/**
 * `/api/speech` 의 raw PCM(24kHz·16bit·mono) 스트림을 **받는 대로** 이어서 재생한다.
 * 첫 청크가 오면 `onStart` 를 부르고, 마지막 소스가 끝나면 resolve 한다. `stopAudio()` 로 중단.
 *
 * 🔴 네트워크 청크는 홀수 바이트로 끊길 수 있다 — Int16 이 1바이트 밀리면 잡음이 된다.
 *    남는 1바이트는 다음 청크 앞에 붙인다.
 */
export const playSpeechStream = async (text: string, onStart?: () => void): Promise<void> => {
  stopAudio();
  const playback = { abort: new AbortController(), sources: new Set<AudioBufferSourceNode>() };
  currentPlayback = playback;

  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  const ctx = sharedAudioContext;
  if (ctx.state === 'suspended') await ctx.resume();

  // 유료 키 라우트라 토큰이 필요하다(게스트 403, 회원 일일 한도 429 — docs/guide/db/tts-quota.sql)
  let response: Response;
  try {
    response = await authedFetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: playback.abort.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') return; // 사용자가 멈춤
    if (error?.message === 'Not authenticated') throw new TtsError('auth', 'no session');
    throw new TtsError('network', error?.message);
  }
  // 422: 읽을 글이 없다(카드·코드만 있는 답변) — 실패가 아니다
  if (response.status === 422) return;
  if (response.status === 403) throw new TtsError('guest');
  if (response.status === 429) throw new TtsError('quota');
  if (response.status === 401) throw new TtsError('auth', '401');
  if (!response.ok || !response.body) throw new TtsError('server', `HTTP ${response.status}`);

  // 공급자별 음량은 서버가 PCM 에 이미 맞춰 보낸다(server/tts/synth.ts TTS_GAIN) — 폴백으로 섞여도 같은 크기
  const gainNode = ctx.createGain();
  const provider = response.headers.get('X-TTS-Provider') ?? 'gemini';
  const startLead = TTS_START_LEAD_SEC[provider] ?? 0.3;
  gainNode.connect(ctx.destination);

  const reader = response.body.getReader();
  let nextStart = 0;
  let lastEnded: Promise<void> = Promise.resolve();
  // 네트워크 청크를 모아 한 번에 예약한다. 🔴 OpenAI 청크는 ~1.4KB(≈28ms)라 그대로 예약하면
  // 2000자에 소스가 ~9,000개 — 경계 반올림 오차가 쌓여 미세한 틱이 나고 모바일에 무겁다.
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;

  const schedule = async () => {
    // 홀수 바이트는 남긴다 — Int16 이 1바이트 밀리면 잡음이 된다(네트워크 청크는 홀수로 끊길 수 있다)
    const usable = pendingBytes - (pendingBytes % 2);
    if (usable <= 0) return;
    const merged = new Uint8Array(pendingBytes);
    let off = 0;
    for (const p of pending) { merged.set(p, off); off += p.length; }
    const rest = merged.slice(usable);
    pending = rest.length ? [rest] : [];
    pendingBytes = rest.length;

    // 0 부터 시작하는 사본이라 byteOffset 정렬 문제(홀수면 Int16Array 를 못 만든다)가 없다
    const audioBuffer = await decodeAudioData(merged.slice(0, usable), ctx, 24000, 1);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    if (nextStart === 0) {
      nextStart = ctx.currentTime + startLead;
      onStart?.();
    }
    // 버퍼링이 재생을 못 따라가 이미 지난 시각이면 지금부터 이어 붙인다
    nextStart = Math.max(nextStart, ctx.currentTime);
    source.start(nextStart);
    nextStart += audioBuffer.duration;

    playback.sources.add(source);
    lastEnded = new Promise<void>(resolve => {
      source.onended = () => { playback.sources.delete(source); resolve(); };
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (currentPlayback !== playback) return;
      if (done) { await schedule(); break; }
      pending.push(value);
      pendingBytes += value.length;
      if (pendingBytes >= TTS_SCHEDULE_MIN_BYTES) await schedule();
    }
    await lastEnded;
  } catch (error: any) {
    // 사용자가 멈춘 것은 실패가 아니다
    if (error?.name === 'AbortError' || currentPlayback !== playback) return;
    // 재생이 시작된 뒤 스트림이 끊기면(서버는 첫 바이트 후 재시도하지 않는다) 받은 만큼 끝까지 들려주고 끝낸다.
    // 바로 throw 하면 버튼은 대기 상태로 돌아가는데 예약된 오디오는 계속 나와 멈출 수 없게 된다.
    if (nextStart > 0) {
      console.warn('[TTS] stream interrupted — playing received audio only', error?.message);
      await lastEnded;
      return;
    }
    throw error instanceof TtsError ? error : new TtsError('server', error?.message);
  } finally {
    if (currentPlayback === playback && playback.sources.size === 0) currentPlayback = null;
  }
};
