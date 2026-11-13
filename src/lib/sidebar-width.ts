/** 데스크톱 사이드바 폭(px) — 끌어서 조절하고 브라우저에 기억한다. 모바일은 서랍이라 고정 폭 그대로 */
export const SIDEBAR_WIDTH = { min: 220, max: 440, initial: 272, step: 16 } as const;
export const SIDEBAR_WIDTH_KEY = 'sidebar_width';

export const clampSidebarWidth = (px: number): number =>
  Number.isFinite(px) ? Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(px))) : SIDEBAR_WIDTH.initial;

/** 저장값 → 폭. 숫자가 아니거나 비어 있으면 기본값(범위 밖 숫자는 범위 안으로) */
export const parseStoredSidebarWidth = (value: string | null): number => {
  if (value === null || !/^\d{1,5}$/.test(value.trim())) return SIDEBAR_WIDTH.initial;
  return clampSidebarWidth(Number(value));
};
