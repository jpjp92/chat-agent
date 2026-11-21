/**
 * 등장 모션을 줄 "새 메시지" 판정 — 순수. 검증: `npx tsx tests/test-new-messages.mts`
 * 계획: docs/plans/PLAN_MOTION_UX_261005.md §7-3
 *
 * 기록 복원·세션 전환 때 대화 전체가 한꺼번에 페이드되지 않게, 이 화면에서 방금 생긴 메시지만 고른다.
 */

// 처음 그려질 때 이 시간 안에 만든 메시지만 새 메시지로 본다 — 새 대화는 첫 메시지가 생겨야 ChatArea 가 마운트된다
export const FRESH_ON_MOUNT_MS = 5000;
// 한 번에 이보다 많이 늘면 기록 복원이다 — 새 턴은 질문·답변 둘씩 늘어난다
const MAX_NEW_PER_UPDATE = 2;

type Msg = { id: string; timestamp: number };

type NewMessageTracker = {
    /** 렌더마다 부른다. 같은 입력으로 두 번 불러도 결과가 같다(StrictMode 이중 렌더). */
    update(input: { messages: Msg[]; sessionId: string | null; isLoadingHistory: boolean; now: number }): void;
    isNew(id: string): boolean;
};

export const createNewMessageTracker = (): NewMessageTracker => {
    let seen: Set<string> | null = null;
    const fresh = new Set<string>();
    let prevSession: string | null = null;
    return {
        update({ messages, sessionId, isLoadingHistory, now }) {
            if (seen === null) {
                seen = new Set();
                for (const m of messages) {
                    seen.add(m.id);
                    if (now - m.timestamp < FRESH_ON_MOUNT_MS) fresh.add(m.id);
                }
            } else {
                const added = messages.filter(m => !seen!.has(m.id)).map(m => m.id);
                // null → id 는 새 대화가 저장된 것이라 전환이 아니다
                const switched = prevSession !== null && prevSession !== sessionId;
                if (!switched && !isLoadingHistory && added.length <= MAX_NEW_PER_UPDATE) {
                    for (const id of added) fresh.add(id);
                }
                for (const id of added) seen.add(id);
            }
            prevSession = sessionId;
        },
        isNew: (id) => fresh.has(id),
    };
};
