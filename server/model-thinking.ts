/**
 * 모델별 thinking 지원 **측정표** — 계열 판정을 대체한다.
 *
 * 이 파일은 `server-only` 를 임포트하지 않는다. 하니스(`tests/test-thinking-config.mts`)가
 * 직접 임포트해야 하기 때문이다. `server/models.ts` 가 그대로 re-export 하므로
 * 호출부는 `server/models` 만 보면 된다.
 *
 * 출처는 문서가 아니라 프로브다(PLAN_MODEL_API_REVIEW_260817 §0·§1). 문서와 실제가 다르다 —
 * 2.5-flash 는 문서상 low·medium·high 를 지원하지만 넷 다 400 으로 거부한다.
 *
 * 계열 판정(`/^gemini-3\./`)으로 하지 않는 이유: 3.5·3.6 은 `minimal` 을 받지만 3.7·3.8 은 400 으로 거부한다.
 * 접두사로 묶으면 그 모델에 `minimal` 이 자동 주입돼 전 호출이 400 이 된다. 빠뜨렸을 때
 * 틀린 값이 확신 있게 적용되므로 열거가 방어막이다.
 */

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export const THINKING_MODE: Record<string, { levels: readonly ThinkingLevel[]; budget: boolean }> = {
    // levels: 그 모델이 받는 thinkingLevel 값. **낮은 것부터** 적는다(첫 원소 = 하한).
    // budget: thinkingBudget 을 받는가.
    "gemini-2.5-flash":      { levels: [],                                budget: true  },
    "gemini-2.5-flash-lite": { levels: [],                                budget: true  },  // 기본 thinking Off
    "gemini-3.5-flash":      { levels: ["minimal", "low", "medium", "high"], budget: true  },
    "gemini-3.6-flash":      { levels: ["minimal", "low", "medium", "high"], budget: false },  // budget 거부
    // 3.7은 minimal을 거부하므로 선택 경로에서도 반드시 이 표를 통해 low를 사용한다.
    "gemini-3.7-flash":      { levels: ["low", "medium", "high"],            budget: true  },  // minimal 없음
    // 3.8 — minimal 400("not supported"), low·medium·high·thinkingBudget 수용. 3.7 과 같다.
    "gemini-3.8-flash":      { levels: ["low", "medium", "high"],            budget: true  },  // minimal 없음
};

/** 그 모델이 받는 **가장 낮은** thinkingLevel. 우리는 거의 모든 경로에서 최저를 원한다(속도). */
export const lowestThinkingLevel = (m: string): ThinkingLevel | undefined => THINKING_MODE[m]?.levels[0];

/** thinkingLevel(enum) 경로인가 — 아니면 thinkingBudget 경로다. 미등록 모델은 budget 쪽(보수적). */
export const usesThinkingLevel = (m: string): boolean => (THINKING_MODE[m]?.levels.length ?? 0) > 0;

/** 그 모델이 이 레벨을 받는가. 미등록 모델은 false. */
export const supportsThinkingLevel = (m: string, level: string): boolean =>
    (THINKING_MODE[m]?.levels as readonly string[] | undefined)?.includes(level) ?? false;
