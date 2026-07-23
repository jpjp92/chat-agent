import 'server-only';

export const SERVER_MODELS = {
    FLASH_3_6: "gemini-3.6-flash",
    FLASH_3_5: "gemini-3.5-flash",
    FLASH: "gemini-2.5-flash",
    FLASH_LITE: "gemini-2.5-flash-lite",
    TTS: "gemini-2.5-flash-preview-tts",
} as const;

export type ServerModelId = typeof SERVER_MODELS[keyof typeof SERVER_MODELS];
export type ChatModelId = typeof SERVER_MODELS.FLASH_3_6 | typeof SERVER_MODELS.FLASH_3_5 | typeof SERVER_MODELS.FLASH | typeof SERVER_MODELS.FLASH_LITE;

// 기본 모델 = 3.6 (Phase A 실그래프 검증 통과, DEV_260723 §11). 3.5·2.5 는 옵션으로 유지.
export const DEFAULT_CHAT_MODEL: ChatModelId = SERVER_MODELS.FLASH_3_6;
export const ROUTER_MODEL = SERVER_MODELS.FLASH_LITE;
export const SUMMARY_MODELS = [
    SERVER_MODELS.FLASH_LITE,
    SERVER_MODELS.FLASH,
] as const;

// 모델별 무료티어 능력 (DEV_260723 §7-9 실측). 축마다 독립 플래그.
//   freeTierSearch : 무료티어 Google Search grounding 가능?  (2.5만 — 3.x 는 429)
//   fastMultimodal : 무료티어 이미지/영상 <60s?              (3.6·2.5, 3.5 는 붕괴)
//   fastLongInput  : 무료티어 URL 등 긴 입력 요약 <60s?       (3.6·2.5, 3.5 는 붕괴)
export const MODEL_CAPS: Record<string, { freeTierSearch: boolean; fastMultimodal: boolean; fastLongInput: boolean }> = {
    "gemini-3.6-flash": { freeTierSearch: false, fastMultimodal: true,  fastLongInput: true  },
    "gemini-3.5-flash": { freeTierSearch: false, fastMultimodal: false, fastLongInput: false },
    "gemini-2.5-flash": { freeTierSearch: true,  fastMultimodal: true,  fastLongInput: true  },
};

// 능력 조회 — 미등록 모델은 보수적 기본값(전부 false → 안전측 강등).
export const modelCaps = (m: string) => MODEL_CAPS[m] ?? { freeTierSearch: false, fastMultimodal: false, fastLongInput: false };

// 3.x 계열 판정 — thinkingLevel(enum)·sampling 정책 공유용(능력과 무관한 순수 계열 구분).
export const isThreeXFlash = (m: string): boolean => m === SERVER_MODELS.FLASH_3_5 || m === SERVER_MODELS.FLASH_3_6;
