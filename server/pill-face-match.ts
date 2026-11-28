/**
 * MFDS 각인 면별 대조 — 검색은 앞·뒤 코드를 합쳐 `overlaps`(OR)로 넓게 받고, `exact` 판정만 여기서 좁힌다.
 * OR 결과 1건을 그대로 exact 로 보면 앞 `ABC`/뒤 `123` 사진에 `ABC` 만 가진 다른 약이 카드로 나갔다(PLAN_PILL_IDENTIFY_261128 G9).
 * 추가 쿼리 없이 받은 행만 거른다 — 지연을 늘리지 않는다.
 */
export function matchesEachFace(markCodes: string[] | null | undefined, frontCodes: string[], backCodes: string[]): boolean {
    const have = new Set((markCodes ?? []).map(c => c.toUpperCase()));
    const hit = (codes: string[]) => codes.some(c => have.has(c.toUpperCase()));
    if (frontCodes.length && !hit(frontCodes)) return false;
    if (backCodes.length && !hit(backCodes)) return false;
    return true;
}
