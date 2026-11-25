/**
 * 라우터 LLM 에 보여 줄 직전 답 — 코드 블록(카드 JSON)은 표시로 줄이고 앞·뒤를 남긴다.
 * 앞 300자만 보던 때는 날씨 턴(한 줄 + 카드 JSON + "찾아볼까요?")에서 끝의 제안이 잘려 "응" 을 카드 해석으로 봤다(DEV_261125 §11-5).
 */
export const previousResponseExcerpt = (content: string): string => {
    const prose = content.replace(/```[\s\S]*?```/g, ' [card shown] ').replace(/\s+/g, ' ').trim();
    return prose.length <= 400 ? prose : `${prose.slice(0, 220)} … ${prose.slice(-160)}`;
};
