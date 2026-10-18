/**
 * MFDS 각인 값 정리 — 순수 함수(네트워크 없음). 검증: `npx tsx tests/test-drug-imprint.mts`
 *
 * MFDS 알약식별 API 는 로고 각인을 `PRINT_FRONT/BACK = "마크"` 로만 주고, 로고에서 읽히는 글자는
 * `MARK_CODE_FRONT_ANAL / MARK_CODE_BACK_ANAL`("dHP,dP,d-P,cHP")에 따로 준다(2026-10-18 확인).
 * 예전엔 ANAL 을 버리고 사진을 비전 모델로 다시 읽었는데:
 *   · 비전이 **사진 위치**(왼쪽=앞, 오른쪽=뒤)로 면을 골랐다. 마그네스정은 MFDS 가 로고를 "뒷면" 으로
 *     적었지만 사진에선 왼쪽 알약에 있어, 비전이 민무늬 오른쪽을 읽고 "없음" → 보정 실패로 "마크" 만 남았다.
 *   · 그 비전 호출의 출력 "없음" 이 GPT 경로에서 답변으로 새 GPT 답을 통째로 막았다(DEV_261018).
 * → ANAL 이 있으면 그것으로 "마크(dHP)" 를 만들고 비전을 부르지 않는다. ANAL 이 없을 때만 비전.
 */

export const MARK_VALUES = ['마크', '마크(로고)', 'mark', 'MARK', '각인'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const isMarkImprint = (v: unknown): boolean => MARK_VALUES.includes(str(v));

/** "dHP,dP,d-P,cHP" → "dHP". ANAL 은 가능한 판독 후보 목록이고 첫 값이 대표다. */
export const firstMarkCode = (anal: unknown): string | null => {
    const first = str(anal).split(',').map(s => s.trim()).find(Boolean);
    return first || null;
};

/** 각인이 "마크" 이고 ANAL 이 있으면 "마크(dHP)", 아니면 원래 값 그대로. */
export const imprintWithMarkCode = (print: unknown, anal: unknown): string | null => {
    const p = str(print);
    if (!p) return null;
    if (!isMarkImprint(p)) return p;
    const code = firstMarkCode(anal);
    return code ? `마크(${code})` : p;
};

/**
 * MFDS 항목 하나의 각인을 정리한다. 반환한 `visionNeeded` 는 ANAL 로도 못 채운 "마크" 면.
 * `onlyOneSide` 는 각인이 한 면에만 있는 경우 — 비전이 위치 대신 "각인이 있는 알약" 을 읽게 하는 데 쓴다.
 */
export const resolveImprints = (item: { PRINT_FRONT?: unknown; PRINT_BACK?: unknown; MARK_CODE_FRONT_ANAL?: unknown; MARK_CODE_BACK_ANAL?: unknown }) => {
    const front = imprintWithMarkCode(item.PRINT_FRONT, item.MARK_CODE_FRONT_ANAL);
    const back = imprintWithMarkCode(item.PRINT_BACK, item.MARK_CODE_BACK_ANAL);
    const visionNeeded = {
        front: isMarkImprint(front),
        back: isMarkImprint(back),
    };
    const onlyOneSide = !!front !== !!back;
    return { front, back, visionNeeded, onlyOneSide };
};
