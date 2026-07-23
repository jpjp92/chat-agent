export const CHAT_MODELS = {
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_3_5: 'gemini-3.5-flash',
  FLASH: 'gemini-2.5-flash',
  FLASH_LITE: 'gemini-2.5-flash-lite',
} as const;

export type ChatModelId = typeof CHAT_MODELS[keyof typeof CHAT_MODELS];

export const DEFAULT_CHAT_MODEL: ChatModelId = CHAT_MODELS.FLASH_3_6;

export const CHAT_MODEL_OPTIONS = [
  {
    id: CHAT_MODELS.FLASH_3_6,
    labelKey: 'model36Flash',
    descriptionKey: 'model36FlashDesc',
  },
  {
    id: CHAT_MODELS.FLASH_3_5,
    labelKey: 'model35Flash',
    descriptionKey: 'model35FlashDesc',
  },
  {
    id: CHAT_MODELS.FLASH,
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
  value === CHAT_MODELS.FLASH_3_6 || value === CHAT_MODELS.FLASH_3_5 || value === CHAT_MODELS.FLASH || value === CHAT_MODELS.FLASH_LITE;
