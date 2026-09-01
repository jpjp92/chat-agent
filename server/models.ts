import 'server-only';

// thinking 실측표는 순수 모듈에 있다(하니스가 임포트해야 해서). 호출부 편의를 위해 re-export.
export { THINKING_MODE, lowestThinkingLevel, usesThinkingLevel, supportsThinkingLevel } from './model-thinking';
export type { ThinkingLevel } from './model-thinking';

export const SERVER_MODELS = {
    FLASH_3_7: "gemini-3.7-flash",
    FLASH_3_6: "gemini-3.6-flash",
    FLASH_3_5: "gemini-3.5-flash",
    FLASH: "gemini-2.5-flash",
    FLASH_LITE: "gemini-2.5-flash-lite",
    TTS: "gemini-2.5-flash-preview-tts",
    GPT_5_4_MINI: "gpt-5.4-mini",
    GPT_5_6_LUNA: "gpt-5.6-luna",
} as const;

export type ChatModelId = typeof SERVER_MODELS.FLASH_3_7 | typeof SERVER_MODELS.FLASH_3_6 | typeof SERVER_MODELS.FLASH_3_5 | typeof SERVER_MODELS.FLASH | typeof SERVER_MODELS.FLASH_LITE | typeof SERVER_MODELS.GPT_5_4_MINI | typeof SERVER_MODELS.GPT_5_6_LUNA;

// 기본 모델 = 3.6 (Phase A 실그래프 검증 통과, DEV_260723 §11). 3.5·2.5 는 옵션으로 유지.
export const DEFAULT_CHAT_MODEL: ChatModelId = SERVER_MODELS.FLASH_3_6;
/**
 * 의도 분류기. 매 턴 serial-blocking 이라 지연이 직접 체감된다.
 *
 * 🔴 flash-lite 에서 **카드 어휘에 반응하는 고정 오분류**가 있었다(실측 2026-09-01,
 * `tests/manual/live-intent-routing.mts`): `강아지 사료 추천해줘` → `vet_search`,
 * `변호사 비용 얼마나 들어?` → `law_search`, `변호사 시험 언제야` → `law_search`.
 * `temperature: 0` 이라 3/3 일관되게 틀렸다 — 흔들림이 아니라 그 모델의 답이었다.
 * 규칙 분류기는 셋 다 `general` 로 정확히 판정하지만, 규칙은 LLM 실패 시 폴백일 뿐이다.
 *
 * `SUMMARY_MODELS`(대화 제목)는 flash-lite 그대로다 — 별개 상수이고 성격도 다르다.
 */
export const ROUTER_MODEL = SERVER_MODELS.FLASH;
export const SUMMARY_MODELS = [
    SERVER_MODELS.FLASH_LITE,
    SERVER_MODELS.FLASH,
] as const;

// 모델별 무료티어 능력 (DEV_260723 §7-9 실측). 축마다 독립 플래그.
//   freeTierSearch : 무료티어 Google Search grounding 가능?  (2.5만 — 3.x 는 429)
//   fastMultimodal : 무료티어 이미지/영상 <60s?              (3.6·2.5, 3.5 는 붕괴)
//   fastLongInput  : 무료티어 URL 등 긴 입력 요약 <60s?       (3.6·2.5, 3.5 는 붕괴)
//   urlFileData    : **임의 URL** fileData 처리 가능?          (2.5만 — 3.x 는 429)
//   groundingReliable : 검색이 발동했을 때 **모델이 그 결과를 실제로 반영**하는가
//
// 🔴 groundingReliable 은 freeTierSearch 와 **다른 축**이다. 지금은 우연히 겹쳐 있다.
//    freeTierSearch 는 **과금 사실**이고(pricing 문서의 "Free Tier: Not available" 그대로),
//    groundingReliable 은 **답변 품질**이다. 유료 티어로 올려 freeTierSearch 를 true 로 뒤집으면
//    3.6 의 강등이 사라지는데, 3.6 은 TIER1 실측에서 **정답률 2/5** 였다
//    (PLAN_MODEL_3_7_MIGRATION_260817 §2). 게다가 **오답 3회 중 2회에 groundingMetadata 가
//    붙어 있었다** — 우리 UI 는 그걸로 출처 칩을 그리므로 **틀린 답에 신뢰 표식이 붙는다.**
//    미발동보다 나쁘다. 두 축을 합쳐 두면 과금 축만 보고 뒤집었을 때 **에러 없이** 그 상태가 된다.
//
// 🔴 urlFileData 는 fastMultimodal 과 다른 축이고, **무료티어 한정이 아니다**(DEV_260808 실측).
//    3.6 은 인라인 이미지도 YouTube fileData 도 되는데 **우리 Storage URL 을 fileData 로 주면
//    429 RESOURCE_EXHAUSTED** 를 낸다. 쿼터가 아니라는 근거 둘:
//      · 같은 키가 직전 텍스트 호출엔 200 을 준다 (무료 키 4개 교차 확인)
//      · **유료 TIER1 키도 동일하게 429** — 티어를 올려도 안 풀린다
//    업로드 영상은 항상, PDF 는 1MB 초과 시(useChatStream 임계값) 이 경로를 탄다.
export const MODEL_CAPS: Record<string, { freeTierSearch: boolean; fastMultimodal: boolean; fastLongInput: boolean; urlFileData: boolean; groundingReliable: boolean }> = {
    "gemini-3.7-flash": { freeTierSearch: false, fastMultimodal: true,  fastLongInput: false, urlFileData: false, groundingReliable: true  },  // 5/5; 긴 입력은 무료티어 혼잡 때문에 핀
    "gemini-3.6-flash": { freeTierSearch: false, fastMultimodal: true,  fastLongInput: true,  urlFileData: false, groundingReliable: false },  // 🔴 정답률 2/5
    "gemini-3.5-flash": { freeTierSearch: false, fastMultimodal: false, fastLongInput: false, urlFileData: false, groundingReliable: true  },  // 5/5
    "gemini-2.5-flash": { freeTierSearch: true,  fastMultimodal: true,  fastLongInput: true,  urlFileData: true , groundingReliable: true  },  // 5/5
};

// 능력 조회 — 미등록 모델은 보수적 기본값(전부 false → 안전측 강등).
export const modelCaps = (m: string) => MODEL_CAPS[m] ?? { freeTierSearch: false, fastMultimodal: false, fastLongInput: false, urlFileData: false, groundingReliable: false };

// 3.x 계열 판정 — sampling 정책·503 강등 대상 판정용(능력과 무관한 순수 계열 구분).
// ⚠️ thinkingLevel 결정에는 **쓰지 않는다** — 그건 `usesThinkingLevel`/`lowestThinkingLevel`(실측표) 몫이다.
//    계열이 같아도 받는 레벨이 다르다(3.5·3.6 은 minimal 을 받고 **3.7 은 400 으로 거부**).
// ⚠️ 접두사 판정(`/^gemini-3\./`)으로 바꾸지 않는다 — 3.7 을 목록에 추가할 때는 여기도 함께 고친다.
export const isThreeXFlash = (m: string): boolean => m === SERVER_MODELS.FLASH_3_5 || m === SERVER_MODELS.FLASH_3_6 || m === SERVER_MODELS.FLASH_3_7;

export const isChatModelId = (m: unknown): m is ChatModelId =>
    typeof m === 'string' && [
        SERVER_MODELS.FLASH_3_7,
        SERVER_MODELS.FLASH_3_6,
        SERVER_MODELS.FLASH_3_5,
        SERVER_MODELS.FLASH,
        SERVER_MODELS.FLASH_LITE,
        SERVER_MODELS.GPT_5_4_MINI,
        SERVER_MODELS.GPT_5_6_LUNA,
    ].includes(m as ChatModelId);
