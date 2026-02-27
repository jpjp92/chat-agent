
/**
 * API Key Management Utility
 * Dynamically loads all Gemini API keys from environment variables.
 */

// Collect all API keys starting with 'API_KEY' (e.g., API_KEY, API_KEY2, API_KEY_TEST, etc.)
export const API_KEYS = Object.keys(process.env)
    .filter(key => key.startsWith('API_KEY'))
    .map(key => process.env[key])
    .filter(Boolean) as string[];

/**
 * Key Rotation Management
 */
let currentKeyIndex = 0;

export const getNextApiKey = () => {
    if (API_KEYS.length === 0) return null;
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
};

// Log the number of keys loaded (optional, for server-side debugging)
console.log(`[Config] Loaded ${API_KEYS.length} Gemini API keys.`);
