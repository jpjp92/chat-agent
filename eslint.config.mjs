import { includeIgnoreFile } from '@eslint/compat';
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
import { fileURLToPath } from 'node:url';

// Next.js 16 에서 `next lint` 가 제거됐다. 그전까지 이 레포의 `npm run lint` 는 `next lint` 를
// 부르고 있었고, 명령이 사라진 뒤로는 "lint" 를 **디렉터리 이름으로 해석**해
// `Invalid project directory provided, no such directory: .../lint` 로 깨진 채 방치돼 있었다
// (2026-08-17 외부 리뷰 지적). ESLint 설정 파일도, 선언된 eslint 의존성도 없었다.
//
// ⚠️ eslint-config-next@16 은 flat config 네이티브다 — `FlatCompat` 으로 감싸면 순환 참조로 죽는다.
//
// ⚠️ ESLint 는 `.gitignore` 를 **보지 않는다.** 그냥 돌리면 `scripts/movie-spike-output/`(스크랩한
//    CGV 번들) 같은 산출물이 전체 지적의 절반 이상을 차지한다(실측: 7643 건 중 4800+).
//    → `.gitignore` 를 그대로 상속시킨다. 하니스 예외(`!scripts/test-*.mts`)도 함께 상속되므로
//      **추적되는 회귀 하니스는 계속 검사된다.**
const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

export default [
    includeIgnoreFile(gitignorePath),
    { ignores: ['preview/**', 'docs/**'] },
    ...coreWebVitals,
    ...typescript,
    {
        rules: {
            // 이 레포에서 `any` 는 결함이 아니라 **관례**다 — LangChain 메시지(`m._getType?.()`)와
            // Gemini SDK 응답은 타입이 느슨해 `(x as any)` 없이는 다루기 어렵다. 에러로 두면
            // 338건 중 304건이 이것 하나여서 나머지 34건(진짜 신호)이 묻힌다. 경고로 남긴다.
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
];
