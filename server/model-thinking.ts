/**
 * 모델별 thinking 지원 **실측표** — 계열 판정을 대체한다.
 *
 * 🔴 이 파일은 `server-only` 를 임포트하지 않는다. 하니스(`tests/test-thinking-config.mts`)가
 *    직접 임포트해야 하기 때문이다. `server/models.ts` 가 그대로 re-export 하므로
 *    호출부는 기존처럼 `server/models` 만 보면 된다.
 *
 * 🔴 출처는 문서가 아니라 프로브다(PLAN_MODEL_API_REVIEW_260817 §0·§1, TIER1 실측 2026-08-17).
 *    문서와 실측이 갈린 사례가 실제로 있었다 — **2.5-flash 는 문서상 low·medium·high 를
 *    지원한다고 적혀 있으나 넷 다 400 으로 거부한다.** 문서만 믿고 통일했으면 깨졌다.
 *
 * 🔴 왜 계열 판정(`/^gemini-3\./`)으로 하지 않는가:
 *    3.5·3.6 은 `minimal` 을 받지만 **3.7 은 `minimal` 을 400 으로 거부한다.**
 *    접두사로 묶으면 3.7 에 `minimal` 이 자동 주입돼 **전 호출 400** 이 된다.
 *    → 판단 기준은 *"중복이 나쁜가"* 가 아니라 ***"빠뜨렸을 때의 기본값이 무엇인가"*** 다.
 *      `url_cache`·`mfds_pills` 에서 목록 누락은 **조용한 소멸**이었지만,
 *      여기서는 **틀린 값의 확신 있는 적용**이다. 그래서 열거가 방어막이다.
 */

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export const THINKING_MODE: Record<string, { levels: readonly ThinkingLevel[]; budget: boolean }> = {
    // levels: 그 모델이 받는 thinkingLevel 값. **낮은 것부터** 적는다(첫 원소 = 하한).
    // budget: thinkingBudget 을 받는가.
    "gemini-2.5-flash":      { levels: [],                                budget: true  },
    "gemini-2.5-flash-lite": { levels: [],                                budget: true  },  // 기본 thinking Off
    "gemini-3.5-flash":      { levels: ["minimal", "low", "medium", "high"], budget: true  },
    "gemini-3.6-flash":      { levels: ["minimal", "low", "medium", "high"], budget: false },  // budget 거부
    // 🟡 3.7 은 아직 선택지가 아니다(SERVER_MODELS·MODEL_CAPS 에 없음). 여기 먼저 적는 이유는
    //    **하니스가 지금부터 `minimal` 주입을 막게 하기 위해서**다. 표에만 있으면 동작은 안 바뀐다.
    "gemini-3.7-flash":      { levels: ["low", "medium", "high"],            budget: true  },  // minimal 없음
};

/** 그 모델이 받는 **가장 낮은** thinkingLevel. 우리는 거의 모든 경로에서 최저를 원한다(속도). */
export const lowestThinkingLevel = (m: string): ThinkingLevel | undefined => THINKING_MODE[m]?.levels[0];

/** thinkingLevel(enum) 경로인가 — 아니면 thinkingBudget 경로다. 미등록 모델은 budget 쪽(보수적). */
export const usesThinkingLevel = (m: string): boolean => (THINKING_MODE[m]?.levels.length ?? 0) > 0;

/** 그 모델이 이 레벨을 받는가. 미등록 모델은 false. */
export const supportsThinkingLevel = (m: string, level: string): boolean =>
    (THINKING_MODE[m]?.levels as readonly string[] | undefined)?.includes(level) ?? false;
