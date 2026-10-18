import 'server-only';

/**
 * 약품 이미지를 받아도 되는 호스트 — sync-drug-image(캐시 저장)와 proxy-image(<img> 프록시)가 같이 쓴다.
 * 두 라우트가 각자 목록을 들면 어긋난다(PLAN_PUBLIC_ROUTE_AUTH_261017 §4-3).
 *
 * 출처: MFDS 공식 이미지(nedrug) · ConnectDI · 약학정보원(common.health.kr) · 네이버 지식백과 경로(pstatic·terms.naver).
 * 하위 도메인 포함. **최종 URL 로 검사한다** — dthumb-phinf `?src=` 처럼 다른 호스트로 바뀌는 URL 이 있다.
 */
const DRUG_IMAGE_HOSTS = ['nedrug.mfds.go.kr', 'pstatic.net', 'connectdi.com', 'terms.naver.com', 'health.kr'];

export const isDrugImageHost = (url: URL): boolean =>
    DRUG_IMAGE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
