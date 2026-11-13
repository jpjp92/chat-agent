import { GenerativeModel } from '@google/generative-ai';

/**
 * 떠돌이 Promise rejection 처리 → docs/plans/PLAN_STABILITY_261112.md §1
 *
 * `process` 는 동시 요청 모두가 공유한다. 요청마다 리스너를 걸면 rejection 1건에 열린 요청 전부가
 * 오류 문구를 받았다. 리스너는 프로세스당 하나, 로그만 — 요청 오류는 각 요청의 try/catch 가 맡는다.
 * 리스너를 아예 없애면 Node 15+ 는 처리 안 된 rejection 에 프로세스를 끝내므로 남겨 둔다.
 */

const GUARD = Symbol.for('chat-agent.process-guard');
const PATCHED = Symbol.for('chat-agent.genai-stream-patched');

const rejectionSummary = (reason: unknown) => {
    const r = reason as { name?: unknown; code?: unknown; status?: unknown } | null;
    // 메시지는 남기지 않는다 — 공급자 오류 문구에 요청 내용이 섞일 수 있다
    return {
        name: typeof r?.name === 'string' ? r.name.slice(0, 60) : typeof reason,
        code: typeof r?.code === 'string' || typeof r?.code === 'number' ? r.code : undefined,
        status: typeof r?.status === 'number' ? r.status : undefined,
    };
};

/**
 * `@google/generative-ai` 의 `generateContentStream` 은 스트림을 tee 해 `response` Promise 를 따로 만든다.
 * LangChain(`@langchain/google-genai`)은 `stream` 만 쓰고 `response` 를 버려서, 스트림이 깨지거나
 * (Failed to parse stream) 25s 타임아웃으로 끊기면 그 Promise 가 받는 쪽 없이 reject 된다.
 * 같은 오류는 `stream` 쪽으로도 오므로 langchain-path 의 catch·재시도는 그대로 동작한다 — 여기선 버려진 쪽만 처리.
 */
const patchGenaiStreamLeak = () => {
    const proto = GenerativeModel.prototype as any;
    if (proto[PATCHED]) return;
    const original = proto.generateContentStream;
    proto.generateContentStream = async function (...args: unknown[]) {
        const result = await original.apply(this, args);
        result?.response?.catch?.(() => {});
        return result;
    };
    proto[PATCHED] = true;
};

export const installProcessGuard = () => {
    patchGenaiStreamLeak();
    const g = globalThis as any;
    if (g[GUARD]) return;
    g[GUARD] = true;
    process.on('unhandledRejection', (reason) => {
        console.error('[process] unhandled rejection', rejectionSummary(reason));
    });
};

/** 하니스용 */
export const __test = { rejectionSummary };
