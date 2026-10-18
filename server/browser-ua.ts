/**
 * 외부 사이트로 나갈 때 쓰는 브라우저 User-Agent — **한 곳에서만 정한다.**
 *
 * 낡은 UA 는 봇 시그니처로 막힌다(예: GeekNews 는 `Chrome/120` 에 403, `Chrome/141` 에 200).
 * 그러면 무료 경로(direct fetch)가 실패하고 유료 스크래퍼로 떠넘겨진다 → DEV_260822
 *
 * 주의: **이 값은 시간이 지나면 조용히 썩는다.** 코드가 바뀌지 않아도 틀려진다.
 * URL 요약이 특정 사이트에서만 403 을 받기 시작하면 **여기를 가장 먼저 의심할 것.**
 * 판별법: 같은 URL 을 최신 Chrome UA 로 한 번 더 쳐 본다. 상태가 갈리면 원인은 이것이다.
 *
 * 실제로 200 을 받은 값만 적는다 — 최신처럼 보이는 숫자를 넣지 않는다.
 */
export const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
