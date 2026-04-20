import { Role, Message, MessageAttachment, Language, GroundingSource } from "../types";

let currentAudioSource: AudioBufferSourceNode | null = null;
let sharedAudioContext: AudioContext | null = null;

const ERROR_MESSAGES: Record<Language, string> = {
  ko: "현재 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  en: "Too many requests. Please try again in a moment.",
  es: "Demasiadas solicitudes. Por favor, inténtelo de nuevo en un momento.",
  fr: "Trop de requêtes. Veuillez réessayer dans un instant."
};

/**
 * 사용자 정보 (Supabase 연동)
 */
export const loginUser = async (nickname: string) => {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname })
  });
  return response.json();
};


export const updateRemoteUserProfile = async (userId: number, profile: { display_name?: string; avatar_url?: string }) => {
  const response = await fetch('/api/auth', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userId, ...profile })
  });
  return response.json();
};

export const uploadToStorage = async (file: { fileName: string; data: string; mimeType: string }, bucket: string) => {
  try {
    // 1. Get Signed Upload URL from backend
    const signRes = await fetch('/api/create-signed-url', {
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
export const fetchSessions = async (userId: number) => {
  const response = await fetch(`/api/sessions?user_id=${userId}`);
  return response.json();
};

export const createSession = async (userId: number, title?: string) => {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, title })
  });
  return response.json();
};

export const fetchSessionMessages = async (sessionId: string) => {
  const response = await fetch(`/api/sessions?session_id=${sessionId}`);
  return response.json();
};

export const deleteSession = async (sessionId: string) => {
  const response = await fetch('/api/sessions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId })
  });
  return response.json();
};

export const updateSessionTitle = async (sessionId: string, title: string) => {
  const response = await fetch('/api/sessions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, title })
  });
  return response.json();
};

/**
 * URL에서 직접 텍스트 또는 파일을 추출 (백엔드 프록시 이용)
 */
export const fetchUrlData = async (url: string): Promise<{ isPdf?: boolean, content: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15초: 서버사이드 10초 + 네트워크 여유
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

export const fetchUrlContent = async (url: string): Promise<string> => {
   const data = await fetchUrlData(url);
   if (!data.content || data.content.startsWith('[FETCH_ERROR')) return '';
   return data.content;
};

/**
 * YouTube 자막 가져오기 (백엔드 프록시)
 */
export const fetchYoutubeTranscript = async (videoId: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('/api/fetch-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
      signal: controller.signal,
    });
    const data = await response.json();
    return data.transcript || null;
  } catch (error) {
    return null;
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
  model: string = 'gemini-2.5-flash'
) => {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, history, language, attachment, webContent, session_id: sessionId, attachments, model, timeZone })
    });

    if (!response.ok) {
      let errorMsg = `Server error: ${response.status}`;
      try {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        }
      } catch {}
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const decoder = new TextDecoder();
    let buffer = "";
    let receivedAnyText = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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
          if (data.error) throw new Error(data.error);
          if (data.text) { onChunk(data.text, false); receivedAnyText = true; }
          if (data.sources && onMetadata) onMetadata(data.sources);
        }
      }
    }

    // 스트림이 데이터 없이 종료된 경우 (Vercel 타임아웃, Gemini 무음 실패 등)
    if (!receivedAnyText) {
      throw new Error('응답을 받지 못했습니다. 다시 시도해주세요.');
    }
  } catch (error: any) {
    console.error("Chat streaming failed", error);
    throw error;
  }
};

export const generateSpeech = async (text: string): Promise<Uint8Array> => {
  const response = await fetch('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return decodeBase64(data.data);
};

export const stopAudio = () => {
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch (e) { }
    currentAudioSource = null;
  }
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

export const playRawAudio = async (data: Uint8Array) => {
  if (data.length === 0) return;
  stopAudio();

  // 이미 initAudioContext로 생성되어 있어야 함
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }

  if (sharedAudioContext.state === 'suspended') {
    await sharedAudioContext.resume();
  }

  const audioBuffer = await decodeAudioData(data, sharedAudioContext, 24000, 1);
  const source = sharedAudioContext.createBufferSource();
  source.buffer = audioBuffer;

  const gainNode = sharedAudioContext.createGain();
  gainNode.gain.value = 1.8;

  source.connect(gainNode);
  gainNode.connect(sharedAudioContext.destination);
  currentAudioSource = source;
  source.start();

  return new Promise<void>((resolve) => {
    source.onended = () => {
      if (currentAudioSource === source) currentAudioSource = null;
      resolve();
    };
  });
};
