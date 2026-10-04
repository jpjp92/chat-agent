import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 요청 단위 Gemini 키 등급 — PLAN_GEMINI_PAID_FIRST_261004 §3-1.
 *
 * 회원 요청만 `paid-first` 로 감싼다(app/api/chat/route.ts). 그 안에서 getNextApiKey() 는
 * 유료 키를 먼저 주고, 유료 키가 쿨다운이면 무료 로테이션으로 내려간다. 감싸지 않은 경로
 * (게스트·무인증 라우트·프로브)는 컨텍스트가 없어 `free` — 유료 키가 새지 않는 쪽이 기본값이다.
 *
 * 호출처(16곳)를 인자로 바꾸지 않으려고 AsyncLocalStorage 를 쓴다. ReadableStream 의 start 는
 * 생성자 안에서 동기 호출되므로, 스트림 **생성**을 감싸면 그래프 실행 전체가 컨텍스트를 물려받는다.
 */
export type KeyTier = 'paid-first' | 'free';

const store = new AsyncLocalStorage<KeyTier>();

export const runWithKeyTier = <T>(tier: KeyTier, fn: () => T): T => store.run(tier, fn);
export const currentKeyTier = (): KeyTier => store.getStore() ?? 'free';
