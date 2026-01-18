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
 * URL에서 직접 텍스트를 추출 (백엔드 프록시 이용)
 */
export const fetchUrlContent = async (url: string): Promise<string> => {
  try {
    const response = await fetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    return data.content || "";
  } catch (error) {
    console.warn("Direct scraping failed", error);
    return "";
  }
};

/**
 * YouTube 자막 가져오기 (백엔드 프록시)
 */
export const fetchYoutubeTranscript = async (videoId: string): Promise<string | null> => {
  try {
    const response = await fetch('/api/fetch-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId })
    });
    const data = await response.json();
    return data.transcript || null;
  } catch (error) {
    return null;
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
    return new Uint8Array(0);
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
      body: JSON.stringify({ history })
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
  onMetadata?: (sources: GroundingSource[]) => void
) => {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, history, language, attachment, webContent })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.error) throw new Error(data.error);
          if (data.text) onChunk(data.text, false);
          if (data.sources && onMetadata) onMetadata(data.sources);
        }
      }
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
  source.connect(sharedAudioContext.destination);
  currentAudioSource = source;
  source.start();

  return new Promise<void>((resolve) => {
    source.onended = () => {
      if (currentAudioSource === source) currentAudioSource = null;
      resolve();
    };
  });
};
