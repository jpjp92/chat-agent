/**
 * 서버 언어 표현의 단일 소스.
 *
 * 예전엔 표현이 세 갈래로 흩어져 있었다 — 클라 코드('ko'), 프롬프트/렌더러 스펙 키('Korean'),
 * 그리고 langchain-path가 **시스템 프롬프트 본문을 정규식으로 역추출**한 대문자 키('KOREAN').
 * 마지막 것이 특히 위험했다: 프롬프트 첫 문장("YOUR ENTIRE RESPONSE MUST BE IN X ONLY")을
 * 손대면 언어가 조용히 영어로 폴백됐다. 이제 langName이 그래프까지 전달되므로 역추출을 없애고
 * 이 모듈 하나만 참조한다.
 *
 * 클라이언트 i18n(컴포넌트 문자열)은 별개 계층이다 — docs/plans/PLAN_I18N_CLEANUP_260602.md
 */

/** 클라이언트가 보내는 언어 코드 */
export type LangCode = 'ko' | 'en' | 'es' | 'fr';
/** 프롬프트·렌더러 스펙에서 쓰는 표시 이름 (Gemini 프롬프트에 그대로 들어간다) */
export type LangName = 'Korean' | 'English' | 'Spanish' | 'French';

export const DEFAULT_LANG_NAME: LangName = 'Korean';

const CODE_TO_NAME: Record<LangCode, LangName> = {
    ko: 'Korean',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
};

/** 알 수 없는 값이면 기본(Korean). 클라 입력을 신뢰하지 않는다. */
export const toLangName = (code: unknown): LangName =>
    (typeof code === 'string' && code in CODE_TO_NAME)
        ? CODE_TO_NAME[code as LangCode]
        : DEFAULT_LANG_NAME;

/** 언어별 문자열 맵에서 안전하게 꺼낸다(누락 시 Korean 폴백). */
export const pickByLang = <T>(map: Record<LangName, T>, langName: LangName): T =>
    map[langName] ?? map[DEFAULT_LANG_NAME];
