/**
 * 영화 카드 컨텍스트 스토어 (클라이언트 전용, 멀티턴 후속 질문 지원).
 *
 * 영화 상영표는 MovieRenderer가 /api/showtimes로 클라이언트에서 가져오므로 서버/LLM 컨텍스트에 없다.
 * 후속 질문("메가박스에만 있는 영화는?")에 답하려면 화면에 표시된 상영표를 LLM에 전달해야 한다.
 * 이 모듈이 현재 화면 카드의 상영표를 모아두고, useChatStream이 다음 메시지에 movieContext로 동봉한다.
 *
 * 키=chainKey(cgv/lotte/mega), 가장 최근 카드의 데이터로 덮어씀(새 카드/지점변경 시 자동 갱신).
 * 스파이크/통합: DEV_260611 §6, DEV_260612.
 */

export interface MovieCtxShow { start: string; screen: string; left: number; total: number }
export interface MovieCtxEntry { movie: string; rating: string; format: string; showtimes: MovieCtxShow[] }
export interface MovieCtxChain { chainName: string; cinema: string; movies: MovieCtxEntry[] }

const store: Record<string, MovieCtxChain> = {};

/** MovieRenderer가 체인별 조회 완료 시 호출 */
export function setChainShowtimes(chainKey: string, data: MovieCtxChain | null): void {
  if (!data || !data.movies?.length) { delete store[chainKey]; return; }
  store[chainKey] = data;
}

/** 현재 표시 중인 카드 데이터가 있는지 */
export function hasMovieContext(): boolean {
  return Object.keys(store).length > 0;
}

/**
 * LLM에 주입할 컴팩트 텍스트. 화면에 없으면 빈 문자열.
 * 체인별 cinema + 영화별(등급/포맷/회차수/시작시각/잔여좌석 요약)을 한국어로 정리.
 */
export function getMovieContextText(): string {
  const chains = Object.values(store);
  if (!chains.length) return '';
  const lines: string[] = [];
  for (const c of chains) {
    lines.push(`■ ${c.cinema}`);
    for (const m of c.movies) {
      const times = m.showtimes.slice(0, 12).map((s) => {
        const seat = s.total ? `${s.left}/${s.total}` : '';
        return seat ? `${s.start}(${s.screen} ${seat})` : `${s.start}(${s.screen})`;
      }).join(', ');
      const more = m.showtimes.length > 12 ? ` 외 ${m.showtimes.length - 12}회` : '';
      const tags = [m.rating, m.format].filter(Boolean).join('/');
      lines.push(`  - ${m.movie}${tags ? ` [${tags}]` : ''}: ${times}${more}`);
    }
  }
  return `[현재 화면에 표시된 영화 상영시간표 — 오늘 기준, 사용자가 보고 있는 카드 데이터]\n${lines.join('\n')}`;
}

/** 세션 전환 등으로 카드가 더 이상 유효하지 않을 때 */
export function clearMovieContext(): void {
  for (const k of Object.keys(store)) delete store[k];
}
