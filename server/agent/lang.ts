/**
 * 서버 언어 표현의 단일 소스.
 *
 * 언어 표현은 클라 코드('ko')와 프롬프트/렌더러 스펙 키('Korean') 둘이고, 둘 다 이 모듈에서 얻는다.
 * langName 은 그래프까지 전달된다 — 시스템 프롬프트 본문에서 언어를 역추출하지 않는다(프롬프트
 * 문장을 고치면 언어가 조용히 영어로 폴백된다).
 *
 * 클라이언트 i18n(컴포넌트 문자열)은 별개 계층이다 — docs/plans/PLAN_I18N_CLEANUP_260602.md
 */

/** 클라이언트가 보내는 언어 코드 */
type LangCode = 'ko' | 'en' | 'es' | 'fr';
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
