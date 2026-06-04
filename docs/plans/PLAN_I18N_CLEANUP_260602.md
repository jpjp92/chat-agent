# 분석: i18n 사용 감사 + src/hooks 분할 / 시스템 최적화 검토

> 작성일: 2026-06-02
> 상태: **1·2단계 적용 완료 (2026-06-04) — 3단계 이후 보류**
> 대상: App.tsx i18n + 전체 컴포넌트 i18n 구조
> 트리거: "App.tsx 언어별 안내문구가 실제 쓰이는지 / src/hooks 분할이 나은지 검토"
> 구현 기록: [../logs/DEV_260604.md](../logs/DEV_260604.md)

---

## 1. App.tsx i18n 키 사용 감사 (15키 × 4언어)

`const t = i18n[language] || i18n.ko` → `t`는 **전부 정적 `.key` 접근**(동적 키 없음, 전체 레포 재검증 완료).

| 분류 | 키 | 근거 |
|---|---|---|
| ✅ 실사용 (7) | `uploadFailed`·`identifyingPill`·`analyzingImage`·`analyzingPaper`·`watchingVideo`·`fetchingUrl` (useChatStream 소비) + `profileUpdateFailed` (App.tsx:253) | |
| ⚠️ 전달O 소비X (2) | `checkingYoutube`·`analyzingTranscript` | `ChatStreamMessages` 타입(12,13)·App.tsx에만, useChatStream 로직서 안 읽힘 |
| ❌ 완전 사망 (6) | `profileUpdated`(주석만)·`renameFailed`·`analyzingDoc`·`analyzingFile`·`analyzingVideo`·`preparingSession` | i18n 정의 외 전체 레포 참조 0건 (재검증 완료) |

→ **7/15만 동작. 6개 완전 사망(24 문자열), 2개 소비처 없음.** doc/file/video 분석·세션준비 안내문은 번역만 있고 표시 코드 없음(리팩터 잔재).

## 2. statusMessages 배관 — App.tsx가 불필요한 중개자

status 8키는 **오직 useChatStream에서만 소비**(호출처 App.tsx:166 단 1곳, 검증 완료). 현재 흐름:
```
App.tsx i18n 정의 → subset 객체로 묶어 prop 전달 → useChatStream이 ChatStreamMessages로 동일 shape 재선언
```
- `language`는 **이미 useChatStream 파라미터**(useChatStream.ts:25, 내부 379·443 사용 중).
- 소비 6곳: 162·192·196·286·293·303. (checkingYoutube·analyzingTranscript는 타입에만, 미소비)

→ status 번역을 useChatStream(또는 옆 모듈)로 옮기고 `language`만 넘기면 **statusMessages prop·subset 객체(8줄)·타입 중복 전부 제거.** 단일 소비처 + language 기존 흐름 + 텍스트 전용 + 타입 보호 → **리스크 아주 낮음.**

## 3. 시스템 전체 i18n 파편화

| 항목 | 수치 |
|---|---|
| 자체 i18n 객체 보유 파일 | **12개** (App + 11 컴포넌트: Bio/Chart/ChatInput/ChatMessage/ChatSidebar/Chemical/Constellation/Diagram/Dialog/Drug/Header) |
| 인라인 `language ===` 삼항 | **20건** (Drug 9, App 5, ChatInput 3, ChatSidebar 2, Header 1) |
| `Language` prop 받는 컴포넌트 | 8개 |

⚠️ **Header.tsx는 `t[option.labelKey]` 동적 키 접근** 사용 → 정적 grep으로 사용 키를 못 잡음. 중앙화 시 주의.

## 4. 시스템 최적화 판단 — 2개의 reframe

**(A) 이건 성능이 아니라 유지보수 최적화다.** i18n은 작은 정적 데이터 → 런타임/번들 비용 ~0. 실익은 "언어 추가 시 12파일 수정"·"패턴 불일치" 해소뿐. 진짜 성능 레버는 다른 곳(thinking, 렌더러 lazy-load, grounding).

**(B) ⭐ 전면 중앙화는 Lighthouse lazy-load와 충돌한다.** 렌더러(Bio/Chart/Chemical/Constellation/Diagram/Drug)는 [PLAN_LIGHTHOUSE](PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md) lazy-load 대상. 이들 i18n을 중앙 모듈로 모아 App이 import하면 **메인 번들로 끌려와 lazy 효과를 깎음.** → 순진한 전면 중앙화는 ROI 마이너스.

## 5. 권장 — 계층적 + "공유 vs 렌더러-로컬" 경계

| 단계 | 작업 | 리스크 | 상태 |
|---|---|---|---|
| **1** | 죽은 키 6개(+타입만 있는 2개) 삭제 | 0 (순수 삭제) | ✅ 완료 (2026-06-04) |
| **2** | statusMessages 배관 제거 → useChatStream로, `language`만 전달 | 아주 낮음 (검증: `npx tsc --noEmit` + 로딩텍스트 스모크) | ✅ 완료 (2026-06-04) |
| **3** | `src/i18n/`에 **공통 문자열만**(에러·status·푸터·공용 UI) 타입드 모듈 + 얇은 `t(language,key)` | 낮음 | 보류 (경계 미확정) |
| **4** | 렌더러 i18n은 **각 렌더러 안에 유지** (lazy 청크 보존) | — | — |
| **5 (보류)** | Drug(9삼항)·App(5삼항) worst-first 점진 이관, 나머지는 건드릴 때만 | — | 보류 |

> **1·2단계 실제 적용 결과 (2026-06-04)** — 분석 당시 예상보다 정리 효과가 컸다.
> - 1단계: 죽은 키 8개(`profileUpdated`·`renameFailed`·`analyzingDoc`·`analyzingFile`·`analyzingVideo`·`preparingSession`·`checkingYoutube`·`analyzingTranscript`) 4언어 전부 삭제 + `t.profileUpdated` 죽은 주석 제거.
> - 2단계: `ChatStreamMessages` 타입 + `statusMessages` prop + App.tsx subset 객체(10줄) 제거. status 번역을 `useChatStream` 내부 모듈 레벨 `STATUS: Record<Language, …>` 맵으로 이관(8키), `const status = STATUS[language] || STATUS.ko`로 소비.
> - **추가 흡수**: useChatStream에 하드코딩돼 있던 한국어 status 2개(`analyzingLargeDoc`, `analyzingAttachment`)도 맵에 넣어 en/es/fr 번역 적용 — 기존 i18n 누락(비한국어 사용자에게 한국어 노출) 동시 해소.
> - **순효과**: App.tsx i18n이 15키×4언어 → `profileUpdateFailed` 1키×4언어로 축소. 유일한 생존 소비처는 [App.tsx](../../App.tsx)의 `t.profileUpdateFailed` 1곳.
> - 검증: `npx tsc --noEmit` 통과, dev 서버(Turbopack) `✓ Compiled` 무에러, 컴파일 산출물에 신규 번역 존재·`statusMessages` 잔재 0 확인. (브라우저 라이브 렌더는 드라이버 부재로 미관찰)

- **i18n 라이브러리(react-i18next 등) 비추천** — 정적 4언어엔 의존성/번들만 증가.
- **순수 데이터 모듈 > 훅** — 상태/이펙트 없는 정적 데이터를 훅으로 감싸는 건 약한 안티패턴. 훅 고집 시 `useI18n`은 얇은 래퍼로만.

## 6. 후속 / 미해결

- [x] 1·2단계 적용 (고ROI·저리스크) — 2026-06-04 완료
- [ ] 3단계 공통 모듈의 정확한 경계(어떤 키가 "공통"인가) 확정
- [ ] Header/Drug 동적 키·다수 삼항 이관 시 회귀 주의
- [ ] 1·2단계 브라우저 라이브 스모크(업로드/약품식별 등 status 표시 경로) — 드라이버 환경에서 확인
