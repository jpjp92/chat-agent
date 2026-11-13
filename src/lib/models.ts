import type { Language } from '../../types';

export const CHAT_MODELS = {
  FLASH_3_8: 'gemini-3.8-flash',
  // 3.7 은 2027-01-28 퇴역 — 목록에서 내리고 저장된 선택값은 3.8 로 바꾼다(resolveStoredModel).
  FLASH_3_7: 'gemini-3.7-flash',
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_3_5: 'gemini-3.5-flash',
  FLASH: 'gemini-2.5-flash',
  GPT_5_4_MINI: 'gpt-5.4-mini',
  GPT_5_6_LUNA: 'gpt-5.6-luna',
  GPT_6_LUNA: 'gpt-6-luna',
} as const;

export type ChatModelId = typeof CHAT_MODELS[keyof typeof CHAT_MODELS];

export const DEFAULT_CHAT_MODEL: ChatModelId = CHAT_MODELS.FLASH_3_6;

/**
 * 모델 선택 UI 문자열의 단일 소스.
 *
 * 문자열을 옵션 옆에 둔다 — `labelKey` 만 두고 문자열을 Header.tsx·ChatInput.tsx 에 따로 두면
 * 모델을 추가할 때 한 곳을 빠뜨려 `t[option.labelKey]` 가 `undefined` 로 조용히 렌더된다(DEV_260829_DEADCODE §5).
 *
 * 제품명(`Gemini 3.8 Flash`·`OpenAI` 등)은 4개 언어 값이 같으므로 **문자열 그대로** 쓴다.
 * 번역이 필요한 것만 `Record<Language, string>` 으로 적으면, 언어 하나만 빠져도 tsc 가 잡는다.
 */
type Localized = string | Record<Language, string>;

/** 화면에 나갈 문자열 하나를 고른다. 제품명은 그대로, 번역문은 해당 언어로. */
export const pickLabel = (value: Localized, language: Language): string =>
  typeof value === 'string' ? value : (value[language] ?? value.ko);

const ALL_CHAT_MODEL_SECTIONS: ReadonlyArray<{ id: string; label: Localized }> = [
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

/**
 * `hiddenFallback` 이 있으면 선택 목록에 안 보인다(11-13 이전 모델 3종). 다시 보이게 하려면 그 줄만 지운다.
 * 숨겼을 뿐 서버 허용 목록(`server/models.ts`·`openai/models.ts`)에서는 빼지 않는다 — 내부 강등·라우터가 쓴다.
 * 로컬에 이 모델이 저장돼 있던 사용자는 `hiddenFallback` 모델로 옮긴다(목록에 없는 모델이 선택된 채 남지 않게).
 */
const ALL_CHAT_MODEL_OPTIONS: ReadonlyArray<{
  id: ChatModelId;
  section: string;
  label: Localized;
  description: Localized;
  hiddenFallback?: ChatModelId;
}> = [
  {
    id: CHAT_MODELS.FLASH_3_8,
    section: 'gemini',
    label: 'Gemini 3.8 Flash',
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
    id: CHAT_MODELS.GPT_6_LUNA,
    section: 'openai',
    label: 'GPT-6 luna',
    description: {
      ko: '최신 OpenAI 모델',
      en: 'Latest OpenAI model',
      es: 'El modelo OpenAI más reciente',
      fr: 'Le dernier modèle OpenAI',
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
    id: CHAT_MODELS.FLASH_3_5,
    section: 'legacy',
    hiddenFallback: CHAT_MODELS.FLASH_3_6,
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
    hiddenFallback: CHAT_MODELS.FLASH_3_6,
    label: 'Gemini 2.5 Flash',
    description: {
      ko: '빠르고 균형 잡힌 응답',
      en: 'Fast & balanced',
      es: 'Rápido y equilibrado',
      fr: 'Rapide et équilibré',
    },
  },
  {
    id: CHAT_MODELS.GPT_5_4_MINI,
    section: 'legacy',
    hiddenFallback: CHAT_MODELS.GPT_5_6_LUNA,
    label: 'GPT-5.4 mini',
    description: {
      ko: '빠르고 효율적인 OpenAI 모델',
      en: 'Fast, efficient OpenAI model',
      es: 'Modelo OpenAI rápido y eficiente',
      fr: 'Modèle OpenAI rapide et efficace',
    },
  },
];

/** 화면에 보이는 모델·섹션 — 숨긴 모델만 있는 섹션은 같이 빠진다 */
export const CHAT_MODEL_OPTIONS = ALL_CHAT_MODEL_OPTIONS.filter(option => !option.hiddenFallback);
export const CHAT_MODEL_SECTIONS = ALL_CHAT_MODEL_SECTIONS.filter(section => CHAT_MODEL_OPTIONS.some(option => option.section === section.id));

export const isChatModelId = (value: string | null): value is ChatModelId =>
  Object.values(CHAT_MODELS).includes(value as ChatModelId);

/** 퇴역 모델 → 후속 모델(서버 server/models.ts 의 RETIRED_CHAT_MODELS 와 같은 표). */
const RETIRED_CHAT_MODELS: Partial<Record<ChatModelId, ChatModelId>> = {
  [CHAT_MODELS.FLASH_3_7]: CHAT_MODELS.FLASH_3_8,
};

/** 로컬에 저장된 선택값 → 쓸 모델. 모르는 값은 기본값, 퇴역 모델은 후속 모델, 숨긴 모델은 대체 모델. */
export const resolveStoredModel = (value: string | null): ChatModelId => {
  if (!isChatModelId(value)) return DEFAULT_CHAT_MODEL;
  const resolved = RETIRED_CHAT_MODELS[value] ?? value;
  return ALL_CHAT_MODEL_OPTIONS.find(option => option.id === resolved)?.hiddenFallback ?? resolved;
};
