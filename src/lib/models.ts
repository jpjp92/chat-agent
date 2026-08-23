export const CHAT_MODELS = {
  FLASH_3_7: 'gemini-3.7-flash',
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_3_5: 'gemini-3.5-flash',
  FLASH: 'gemini-2.5-flash',
  FLASH_LITE: 'gemini-2.5-flash-lite',
  GPT_5_4_MINI: 'gpt-5.4-mini',
  GPT_5_6_LUNA: 'gpt-5.6-luna',
} as const;

export type ChatModelId = typeof CHAT_MODELS[keyof typeof CHAT_MODELS];

export const DEFAULT_CHAT_MODEL: ChatModelId = CHAT_MODELS.FLASH_3_6;

export const CHAT_MODEL_SECTIONS = [
  { id: 'gemini', labelKey: 'modelSectionGemini' },
  { id: 'openai', labelKey: 'modelSectionOpenAI' },
  { id: 'legacy', labelKey: 'modelSectionLegacy' },
] as const;

export const CHAT_MODEL_OPTIONS = [
  {
    id: CHAT_MODELS.FLASH_3_7,
    section: 'gemini',
    labelKey: 'model37Flash',
    descriptionKey: 'model37FlashDesc',
  },
  {
    id: CHAT_MODELS.FLASH_3_6,
    section: 'gemini',
    labelKey: 'model36Flash',
    descriptionKey: 'model36FlashDesc',
  },
  {
    id: CHAT_MODELS.GPT_5_4_MINI,
    section: 'openai',
    labelKey: 'modelGpt54Mini',
    descriptionKey: 'modelGpt54MiniDesc',
  },
  {
    id: CHAT_MODELS.GPT_5_6_LUNA,
    section: 'openai',
    labelKey: 'modelGpt56Luna',
    descriptionKey: 'modelGpt56LunaDesc',
  },
  {
    id: CHAT_MODELS.FLASH_3_5,
    section: 'legacy',
    labelKey: 'model35Flash',
    descriptionKey: 'model35FlashDesc',
  },
  {
    id: CHAT_MODELS.FLASH,
    section: 'legacy',
    labelKey: 'model25Flash',
    descriptionKey: 'model25FlashDesc',
  },
  // {
  //   id: CHAT_MODELS.FLASH_LITE,
  //   labelKey: 'model25FlashLite',
  //   descriptionKey: 'model25LiteDesc',
  // },
] as const;

export const isChatModelId = (value: string | null): value is ChatModelId =>
  Object.values(CHAT_MODELS).includes(value as ChatModelId);
