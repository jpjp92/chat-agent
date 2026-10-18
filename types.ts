
export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export type Language = 'ko' | 'en' | 'es' | 'fr';

export interface MessageAttachment {
  data: string;
  mimeType: string;
  fileName?: string;
  fileSize?: number; // 바이트 — 대화 기록 카드 표시용
  extractedText?: string; // 클라이언트에서 추출한 텍스트 (docx, txt 등)
  pdfText?: string; // PDF 텍스트층 — 첫 턴엔 안 쓰고 후속 턴 lastActiveDoc 근거로만(lib/pdf-text.ts)
  storageUrl?: string; // 저장용 업로드 URL (현재 분석은 인라인 데이터를 그대로 씀)
}

export type SourceType = 'web' | 'video' | 'pdf' | 'image' | 'text';

export interface GroundingSource {
  title: string;
  uri: string;
  /** 본문 내 클릭 가능한 인용 번호. 검색만 했지만 인용하지 않은 출처에는 없다. */
  citationNumber?: number;
  cited?: boolean;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  attachments?: MessageAttachment[]; // 첨부 여러 개
  attachment?: MessageAttachment;
  sourceType?: SourceType;
  groundingSources?: GroundingSource[];
  isCutOff?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  lastActiveDoc?: MessageAttachment; // 해당 세션에서 마지막으로 업로드된 문서 컨텍스트 유지용
}

export interface UserProfile {
  name: string;
  avatarUrl: string;
}
