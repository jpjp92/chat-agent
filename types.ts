
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
  fileSize?: number; // bytes — for display in chat history cards
  extractedText?: string; // Client-side extracted text (for docx, txt, etc.)
  storageUrl?: string; // Uploaded URL for persistence while keeping inline data for current analysis
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
  attachments?: MessageAttachment[]; // New: Multiple attachments
  attachment?: MessageAttachment;
  sourceType?: SourceType;
  groundingSources?: GroundingSource[];
  isCutOff?: boolean;
  // 하위 호환성을 위해 image 필드 유지
  image?: MessageAttachment;
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
