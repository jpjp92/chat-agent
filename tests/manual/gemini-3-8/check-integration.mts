/** Offline readiness audit. Imports production policies; does not register or patch the model. */
import { writeFileSync } from 'node:fs';
import { isChatModelId, isThreeXFlash, MODEL_CAPS, DEFAULT_CHAT_MODEL } from '../../../server/models';
import { CHAT_MODELS, CHAT_MODEL_OPTIONS, DEFAULT_CHAT_MODEL as UI_DEFAULT } from '../../../src/lib/models';
import { THINKING_MODE, lowestThinkingLevel } from '../../../server/model-thinking';
import { resolveThinkingConfig, thinkingRetryLevel } from '../../../server/agent/nodes/generation-config';
const model = 'gemini-3.8-flash';
const contexts = [
    { name: 'general', intent: 'general' },
    { name: 'renderer', intent: 'data_viz' },
    { name: 'medical', intent: 'medical_qa' },
    { name: 'long-url', intent: 'general', hasUrlContent: true },
    { name: 'media', intent: 'general', isMediaTurn: true },
    { name: 'youtube', intent: 'general', isYoutubeRequest: true },
].map(({ name, ...ctx }) => ({ name, config: resolveThinkingConfig({
    model, isYoutubeRequest: false, hasVideoData: false, hasUrlContent: false,
    isMediaTurn: false, ...ctx,
}) ?? null }));
const checks = {
    serverAllowlist: isChatModelId(model),
    clientRegistry: Object.values(CHAT_MODELS).some(id => id === (model as string)),
    visibleOption: CHAT_MODEL_OPTIONS.some(option => option.id === (model as string)),
    explicitCapabilities: Object.hasOwn(MODEL_CAPS, model),
    threeXSamplingPolicy: isThreeXFlash(model),
    explicitThinking: Object.hasOwn(THINKING_MODE, model) && lowestThinkingLevel(model) === 'low',
    noMinimal: THINKING_MODE[model]?.levels.includes('minimal') === false,
    retryUsesLow: thinkingRetryLevel(model, 'medium') === 'low',
    defaultParity: DEFAULT_CHAT_MODEL === UI_DEFAULT,
};
const report = { model, ready: Object.values(checks).every(Boolean), checks, contexts,
    defaults: { server: DEFAULT_CHAT_MODEL, client: UI_DEFAULT },
    scope: 'Static configuration readiness only. No network, API key, or model execution.' };
const index = process.argv.indexOf('--out');
if (index >= 0) {
    if (!process.argv[index + 1]) throw new Error('--out requires a path');
    writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
// A missing integration is a finding, not a passing adoption test.
if (!report.ready) process.exitCode = 2;
