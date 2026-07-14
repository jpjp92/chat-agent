/**
 * 게스트가 로그인 없이 보낼 수 있는 사용자 메시지 수.
 *
 * 강제는 **서버에서만** 한다(app/api/chat/route.ts). 클라이언트는 이 값을
 * 안내 문구에만 쓴다 — 클라이언트 카운터는 우회가 자명하므로 방어가 아니다.
 *
 * 목적은 회원 전환이 아니라 무료 Gemini 키의 일일 할당량(RPD) 방어다.
 * 소진되면 소유자 본인이 24시간 못 쓴다(DEV_260624 §7).
 */
export const GUEST_MESSAGE_LIMIT = 5;

/** 서버가 제한 초과 시 반환하는 에러 코드. 클라이언트가 이 값으로 로그인 모달을 띄운다. */
export const GUEST_LIMIT_ERROR = 'guest_limit_reached';
