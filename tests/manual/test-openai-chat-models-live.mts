/**
 * OpenAI 채팅 모델 라이브 스모크 테스트.
 *
 * 실제 API 비용이 발생하므로 일반 `npm test`에는 포함하지 않는다.
 * `.env.local` 또는 `.env`의 OPENAI_API_KEY_TIER1을 읽으며 키 값은 출력하지 않는다.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { generateOpenAIChat } from '../../server/openai/chat.js';

for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}

if (!process.env.OPENAI_API_KEY_TIER1) {
    console.error('OPENAI_API_KEY_TIER1이 .env.local 또는 .env에 없습니다.');
    process.exit(1);
}

const models = ['gpt-5.4-mini', 'gpt-5.6-luna'] as const;
let failed = false;

for (const model of models) {
    const startedAt = Date.now();
    try {
        const result = await generateOpenAIChat({
            model,
            instructions: 'You are a connectivity test. Follow the user instruction exactly.',
            messages: [
                new HumanMessage('Reply with exactly: FIRST'),
                new AIMessage('FIRST'),
                new HumanMessage('Reply with exactly: SECOND'),
            ],
            useWebSearch: false,
            maxOutputTokens: 32,
            timeoutMs: 60_000,
        });
        const text = result.text.trim();
        if (text !== 'SECOND') throw new Error(`unexpected response: ${text}`);
        console.log(`PASS ${model} (${Date.now() - startedAt}ms, ${text.length} chars)`);
    } catch (error: any) {
        failed = true;
        console.error(`FAIL ${model} (${Date.now() - startedAt}ms)`, {
            status: error?.status,
            code: error?.code,
            type: error?.type,
            message: error?.message,
        });
    }
}

if (failed) process.exit(1);
