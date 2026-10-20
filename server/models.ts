import 'server-only';

// thinking 측정표는 순수 모듈에 있다(하니스가 임포트해야 해서). 호출부 편의를 위해 re-export.
export { THINKING_MODE, lowestThinkingLevel, usesThinkingLevel, supportsThinkingLevel } from './model-thinking';
export type { ThinkingLevel } from './model-thinking';

export const SERVER_MODELS = {
    FLASH_3_8: "gemini-3.8-flash",
    // 3.7 은 2027-01-28 퇴역 — 요청이 오면 3.8 로 바꿔 보낸다(resolveChatModel). 허용 목록에는 남긴다(저장된 선택값).
    FLASH_3_7: "gemini-3.7-flash",
    FLASH_3_6: "gemini-3.6-flash",
    FLASH_3_5: "gemini-3.5-flash",
    FLASH: "gemini-2.5-flash",
    FLASH_LITE: "gemini-2.5-flash-lite",
    // 3.8 Flash Lite TTS — Gemini 중 가장 빠르고 문장 누락이 없다. 3.1(preview)은 누락·느림·비쌈,
    // 2.5 는 stream 호출도 한 덩어리 — PLAN_TTS_STREAMING_261002 §4-2d
    TTS: "gemini-3.8-flash-lite-tts",
    // 폴백 — 한도가 모델 단위라 Lite 와 따로 논다. 2.5·3.1 TTS 는 2026-11-17 종료(PLAN_TTS §10-1)
    TTS_FALLBACK: "gemini-3.8-flash-tts",
    GPT_5_4_MINI: "gpt-5.4-mini",
    GPT_5_6_LUNA: "gpt-5.6-luna",
    GPT_6_LUNA: "gpt-6-luna",
} as const;

export type ChatModelId = typeof SERVER_MODELS.FLASH_3_8 | typeof SERVER_MODELS.FLASH_3_7 | typeof SERVER_MODELS.FLASH_3_6 | typeof SERVER_MODELS.FLASH_3_5 | typeof SERVER_MODELS.FLASH | typeof SERVER_MODELS.FLASH_LITE | typeof SERVER_MODELS.GPT_5_4_MINI | typeof SERVER_MODELS.GPT_5_6_LUNA | typeof SERVER_MODELS.GPT_6_LUNA;

// 기본 모델 = 3.6 (DEV_260723 §11). 나머지는 선택 옵션.
export const DEFAULT_CHAT_MODEL: ChatModelId = SERVER_MODELS.FLASH_3_6;
/**
 * 의도 분류기. 매 턴 serial-blocking 이라 지연이 직접 체감된다.
 *
 * flash-lite 는 카드 어휘에 반응하는 고정 오분류가 있다(`강아지 사료 추천해줘` → `vet_search`,
 * `변호사 비용 얼마나 들어?` → `law_search`) — temperature 0 에서 일관되게 틀린다
 * (`tests/manual/live-intent-routing.mts`). 규칙 분류기는 LLM 실패 시 폴백일 뿐이다.
 *
 * `SUMMARY_MODELS`(대화 제목)는 flash-lite 그대로다 — 별개 상수이고 성격도 다르다.
 */
export const ROUTER_MODEL = SERVER_MODELS.FLASH;
export const SUMMARY_MODELS = [
    SERVER_MODELS.FLASH_LITE,
    SERVER_MODELS.FLASH,
] as const;

// 모델별 무료티어 능력 (DEV_260723 §7-9). 축마다 독립 플래그.
//   freeTierSearch : 무료티어 Google Search grounding 가능?  (2.5만 — 3.x 는 429)
//   fastMultimodal : 무료티어 이미지/영상이 충분히 빠른가?    (3.6·2.5, 3.5 는 붕괴)
//   fastLongInput  : 무료티어 URL 등 긴 입력 요약이 빠른가?   (3.6·2.5, 3.5 는 붕괴)
//   urlFileData    : **임의 URL** fileData 처리 가능?          (2.5만 — 3.x 는 429)
//   groundingReliable : 검색이 발동했을 때 **모델이 그 결과를 실제로 반영**하는가
//
// groundingReliable 은 freeTierSearch 와 **다른 축**이다. freeTierSearch 는 **과금 사실**이고
// groundingReliable 은 **답변 품질**이다. 합쳐 두면 과금 축만 보고 뒤집었을 때 품질이 낮은 모델의
// 틀린 답에 출처 칩(신뢰 표식)이 붙는 상태가 에러 없이 된다(PLAN_MODEL_3_7_MIGRATION_260817 §2).
//
// urlFileData 는 fastMultimodal 과 다른 축이고, **무료티어 한정이 아니다**(DEV_260808).
// 3.x 는 인라인 이미지도 YouTube fileData 도 되는데 Storage URL 을 fileData 로 주면 유료 키로도
// 429 RESOURCE_EXHAUSTED 를 낸다(쿼터 문제가 아니다).
// 업로드 영상은 항상, PDF 는 1MB 초과 시(useChatStream 임계값) 이 경로를 탄다.
export const MODEL_CAPS: Record<string, { freeTierSearch: boolean; fastMultimodal: boolean; fastLongInput: boolean; urlFileData: boolean; groundingReliable: boolean }> = {
    // 3.8 — 유료 키 프로브(tests/manual/probe-gemini-38.mts): 검색 grounding·함수 호출·인라인 이미지 정상.
    // 무료티어 측정 전이라 3.7 값을 보수적으로 따른다(긴 입력 핀 유지, urlFileData false).
    "gemini-3.8-flash": { freeTierSearch: false, fastMultimodal: true,  fastLongInput: false, urlFileData: false, groundingReliable: true  },
    "gemini-3.7-flash": { freeTierSearch: false, fastMultimodal: true,  fastLongInput: false, urlFileData: false, groundingReliable: true  },  // 5/5; 긴 입력은 무료티어 혼잡 때문에 핀
    "gemini-3.6-flash": { freeTierSearch: false, fastMultimodal: true,  fastLongInput: true,  urlFileData: false, groundingReliable: true  },  // 2026-10-04 21/21 (검색 끄면 0/7 인 문항, PLAN_GEMINI_PAID_FIRST §7-1). 08-17 의 2/5 는 09-22·10-04 두 번 재현 안 됨
    "gemini-3.5-flash": { freeTierSearch: false, fastMultimodal: false, fastLongInput: false, urlFileData: false, groundingReliable: true  },  // 5/5
    "gemini-2.5-flash": { freeTierSearch: true,  fastMultimodal: true,  fastLongInput: true,  urlFileData: true , groundingReliable: true  },  // 5/5
};

// 능력 조회 — 미등록 모델은 보수적 기본값(전부 false → 안전측 강등).
export const modelCaps = (m: string) => MODEL_CAPS[m] ?? { freeTierSearch: false, fastMultimodal: false, fastLongInput: false, urlFileData: false, groundingReliable: false };

// 3.x 계열 판정 — sampling 정책·503 강등 대상 판정용(능력과 무관한 순수 계열 구분).
// 주의: thinkingLevel 결정에는 **쓰지 않는다** — 그건 `usesThinkingLevel`/`lowestThinkingLevel`(측정표) 몫이다.
// 계열이 같아도 받는 레벨이 다르다(3.5·3.6 은 minimal 을 받고 3.7·3.8 은 400 으로 거부).
// 주의: 접두사 판정(`/^gemini-3\./`)으로 바꾸지 않는다 — 모델을 추가할 때는 여기도 함께 고친다.
export const isThreeXFlash = (m: string): boolean => m === SERVER_MODELS.FLASH_3_5 || m === SERVER_MODELS.FLASH_3_6 || m === SERVER_MODELS.FLASH_3_7 || m === SERVER_MODELS.FLASH_3_8;

export const isChatModelId = (m: unknown): m is ChatModelId =>
    typeof m === 'string' && [
        SERVER_MODELS.FLASH_3_8,
        SERVER_MODELS.FLASH_3_7,
        SERVER_MODELS.FLASH_3_6,
        SERVER_MODELS.FLASH_3_5,
        SERVER_MODELS.FLASH,
        SERVER_MODELS.FLASH_LITE,
        SERVER_MODELS.GPT_5_4_MINI,
        SERVER_MODELS.GPT_5_6_LUNA,
        // 선택 UI 에서 legacy 로 내린 모델(5.4 mini)도 여기 남긴다 — 이유는 openai/models.ts 참조.
        SERVER_MODELS.GPT_6_LUNA,
    ].includes(m as ChatModelId);

/**
 * 퇴역 모델 → 후속 모델. 저장된 선택값·예전 클라이언트가 보낸 ID 를 여기서 바꾼다.
 * 3.7 Flash 는 2027-01-28 퇴역(Google 공지) — 그 뒤엔 Google 이 3.8 로 자동 폴백하지만,
 * 그 전에 우리가 먼저 3.8 로 보내 thinking·능력 표가 실제 모델과 어긋나지 않게 한다 → DEV_261018 §7
 */
const RETIRED_CHAT_MODELS: Partial<Record<ChatModelId, ChatModelId>> = {
    [SERVER_MODELS.FLASH_3_7]: SERVER_MODELS.FLASH_3_8,
};

/** 요청 모델 → 실제로 부를 모델. 허용 목록 밖이면 기본값, 퇴역 모델이면 후속 모델. */
export const resolveChatModel = (m: unknown): ChatModelId => {
    if (!isChatModelId(m)) return DEFAULT_CHAT_MODEL;
    return RETIRED_CHAT_MODELS[m] ?? m;
};
