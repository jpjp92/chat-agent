import type { Language } from '../../types';

export const CHAT_MODELS = {
  FLASH_3_7: 'gemini-3.7-flash',
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_3_5: 'gemini-3.5-flash',
  FLASH: 'gemini-2.5-flash',
  GPT_5_4_MINI: 'gpt-5.4-mini',
  GPT_5_6_LUNA: 'gpt-5.6-luna',
} as const;

export type ChatModelId = typeof CHAT_MODELS[keyof typeof CHAT_MODELS];

export const DEFAULT_CHAT_MODEL: ChatModelId = CHAT_MODELS.FLASH_3_6;

/**
 * 모델 선택 UI 문자열의 단일 소스.
 *
 * 예전엔 레지스트리가 `labelKey` 만 갖고 실제 문자열은 `Header.tsx`(모바일)와
 * `ChatInput.tsx`(데스크톱) **양쪽에** 4개 언어 × 15키로 중복돼 있었다. 모델 하나를
 * 추가하려면 세 파일을 고쳐야 했고, 한 곳을 빠뜨리면 `t[option.labelKey]` 가 `undefined`
 * 로 조용히 렌더됐다 — 아무것도 막아주지 않았다. 문자열을 옵션 옆으로 옮겨 그 인디렉션
 * 자체를 없앴다(DEV_260829_DEADCODE §5).
 *
 * 🔴 제품명(`Gemini 3.7 Flash`·`OpenAI` 등)은 4개 언어 값이 같으므로 **문자열 그대로** 쓴다.
 * 번역이 필요한 것만 `Record<Language, string>` 으로 적으면, 언어 하나만 빠져도 tsc 가 잡는다.
 */
type Localized = string | Record<Language, string>;

/** 화면에 나갈 문자열 하나를 고른다. 제품명은 그대로, 번역문은 해당 언어로. */
export const pickLabel = (value: Localized, language: Language): string =>
  typeof value === 'string' ? value : (value[language] ?? value.ko);

export const CHAT_MODEL_SECTIONS: ReadonlyArray<{ id: string; label: Localized }> = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
  {
    id: 'legacy',
    label: {
      ko: '이전 모델',
      en: 'Previous models',
      es: 'Modelos anteriores',
      fr: 'Modèles précédents',
    },
  },
];

export const CHAT_MODEL_OPTIONS: ReadonlyArray<{
  id: ChatModelId;
  section: string;
  label: Localized;
  description: Localized;
}> = [
  {
    id: CHAT_MODELS.FLASH_3_7,
    section: 'gemini',
    label: 'Gemini 3.7 Flash',
    description: {
      ko: '최신 Gemini Flash',
      en: 'Latest Gemini Flash',
      es: 'El Gemini Flash más reciente',
      fr: 'Le dernier Gemini Flash',
    },
  },
  {
    id: CHAT_MODELS.FLASH_3_6,
    section: 'gemini',
    label: 'Gemini 3.6 Flash',
    description: {
      ko: '빠르고 안정적인 기본 모델',
      en: 'Fast, stable default',
      es: 'Modelo predeterminado rápido y estable',
      fr: 'Modèle rapide et stable par défaut',
    },
  },
  {
    id: CHAT_MODELS.GPT_5_6_LUNA,
    section: 'openai',
    label: 'GPT-5.6 luna',
    description: {
      ko: '균형 잡힌 OpenAI 모델',
      en: 'Balanced OpenAI model',
      es: 'Modelo OpenAI equilibrado',
      fr: 'Modèle OpenAI équilibré',
    },
  },
  {
    id: CHAT_MODELS.GPT_5_4_MINI,
    section: 'openai',
    label: 'GPT-5.4 mini',
    description: {
      ko: '빠르고 효율적인 OpenAI 모델',
      en: 'Fast, efficient OpenAI model',
      es: 'Modelo OpenAI rápido y eficiente',
      fr: 'Modèle OpenAI rapide et efficace',
    },
  },
  {
    id: CHAT_MODELS.FLASH_3_5,
    section: 'legacy',
    label: 'Gemini 3.5 Flash',
    description: {
      ko: '균형 잡힌 이전 세대 모델',
      en: 'Balanced previous-generation model',
      es: 'Modelo equilibrado de generación anterior',
      fr: 'Modèle équilibré de génération précédente',
    },
  },
  {
    id: CHAT_MODELS.FLASH,
    section: 'legacy',
    label: 'Gemini 2.5 Flash',
    description: {
      ko: '빠르고 균형 잡힌 응답',
      en: 'Fast & balanced',
      es: 'Rápido y equilibrado',
      fr: 'Rapide et équilibré',
    },
  },
];

export const isChatModelId = (value: string | null): value is ChatModelId =>
  Object.values(CHAT_MODELS).includes(value as ChatModelId);
