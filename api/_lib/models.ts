export const SERVER_MODELS = {
    FLASH: "gemini-2.5-flash",
    FLASH_LITE: "gemini-2.5-flash-lite",
    TTS: "gemini-2.5-flash-preview-tts",
} as const;

export type ServerModelId = typeof SERVER_MODELS[keyof typeof SERVER_MODELS];
export type ChatModelId = typeof SERVER_MODELS.FLASH | typeof SERVER_MODELS.FLASH_LITE;

export const DEFAULT_CHAT_MODEL: ChatModelId = SERVER_MODELS.FLASH;
export const ROUTER_MODEL = SERVER_MODELS.FLASH_LITE;
export const SUMMARY_MODELS = [SERVER_MODELS.FLASH_LITE, SERVER_MODELS.FLASH] as const;
