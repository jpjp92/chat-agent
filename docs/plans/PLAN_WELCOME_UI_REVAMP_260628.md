# PLAN: 웰컴 화면 UI 정비 (Claude/ChatGPT식)

> 작성일: 2026-06-28
> **상태: 구현 완료 (2026-06-28, [DEV_260628](../logs/2026/06/DEV_260628.md)).** 아래 결정표 일부는 구현·검토 중 갱신됨(반응형 배치·웰컴 문구·칩 모바일 숨김·입력창 폭 통일).
> 프로토타입: [reference/render_ui/test_proposal.html](../../reference/render_ui/test_proposal.html) (현행 앱 클래스 그대로 재현, 데모 토글 포함)
> 관련 코드: [App.tsx](../../App.tsx) · [components/Header.tsx](../../components/Header.tsx) · [components/ChatInput.tsx](../../components/ChatInput.tsx) · [components/WelcomeMessage.tsx](../../components/WelcomeMessage.tsx) · [components/SuggestChips.tsx](../../components/SuggestChips.tsx) · [src/lib/models.ts](../../src/lib/models.ts)

---

## 배경 / 목표

웰컴(빈) 화면을 Claude/ChatGPT식으로 정비한다. 핵심: **모델 선택기를 헤더에서 입력창으로 통합**하고, **추천 칩**을 추가하며, 웰컴에서 **입력창을 중앙으로 올리고 대화 시작 시 하단으로 내리는** 전환을 넣는다. 현행 앱의 비주얼 아이덴티티(violet primary, 그라데이션 타이틀, `rounded-[28px]` 입력창, pill 컴포넌트)는 유지한다.

비범위: 사이드바·프로필 모달·메시지 렌더러는 변경하지 않는다.

---

## 확정 결정 (브레인스토밍 2026-06-28)

| 항목 | 결정 |
|---|---|
| 모델 선택기 위치 | **반응형 하이브리드**: 데스크톱(md+)=입력창 우측 클러스터(Claude식) / 모바일(<md)=헤더 좌측(Gemini식). 2026-06-28 모바일 레퍼런스(GPT·Gemini) 반영 — 모바일은 입력창 폭 부족으로 헤더가 나음 |
| 모델 드롭다운 방향 | 데스크톱(입력창): 웰컴=아래/대화중=위 적응형. 모바일(헤더): 아래로 |
| 모델 옵션 | **3.5·2.5만** (`CHAT_MODEL_OPTIONS` 이미 Lite 주석 처리 — 변경 불필요) |
| 헤더 | **bare 플로팅**(배경 pill 없음): 좌=햄버거+(모바일)모델 / 우=아바타. 데스크톱 좌측은 비고 모델은 입력창에 |
| 첨부 아이콘 | `fa-paperclip` → **`fa-plus`** |
| 웰컴 메시지 | 2단(큰 인사+부제) → **한 줄**. 최종 문구 `무엇을 도와드릴까요?`(모바일 1줄 들어가게 간결화, 모바일·웹 공통) |
| 추천 칩 | **4종**(검색·영화·약·코드), 라인 아이콘, 클릭 시 **입력창에 샘플 1개 채움**(편집·포커스) |
| 칩 반응형 | **모바일 숨김(`sm`+ 에서만 표시)** / 데스크톱 wrap-center, 모바일 칩 축소. (가로 스크롤→중앙→모바일 제거로 수렴) |
| 웰컴 레이아웃 | 데스크톱=그리팅+입력창(중앙)+칩 / **모바일=그리팅 중앙+입력창 하단(footer, 기존 위치 유지)**. 모바일은 입력창이 늘 하단 |
| 입력창 폭 | 웰컴·대화 모두 **`max-w-4xl` 통일**(전환 시 폭 점프 제거). main 콘텐츠 래퍼 3xl→4xl |
| 대화 시작 전환 | (데스크톱) 칩·그리팅 사라지고 입력창이 중앙→하단으로. (모바일) 입력창은 늘 하단이라 안 움직임 |
| 다국어 | 칩 라벨·샘플 + 웰컴 + placeholder + 모델 설명 전부 **ko/en/es/fr** |

---

## i18n 문구표 (확정)

### 웰컴 한 줄
| lang | 문구 |
|---|---|
| ko | 무엇을 도와드릴까요? |
| en | What's on your mind? |
| es | ¿De qué hablamos hoy? |
| fr | De quoi parlons-nous ? |

### 추천 칩 (라벨 / 샘플 프롬프트)
| 기능(icon) | ko | en | es | fr |
|---|---|---|---|---|
| 검색 `fa-magnifying-glass` | 실시간 검색 / "오늘 서울 날씨 어때?" | Live search / "What's the weather in Seoul today?" | Buscar / "¿Qué tiempo hace hoy en Seúl?" | Recherche / "Quel temps fait-il à Séoul aujourd'hui ?" |
| 영화 `fa-film` | 영화 상영표 / "강남 영화 상영시간표 알려줘" | Movie times / "Show movie showtimes in Gangnam" | Cine / "Muéstrame la cartelera de cine en Gangnam" | Cinéma / "Affiche les séances de cinéma à Gangnam" |
| 약 `fa-pills` | 약 정보 / "타이레놀 효능과 복용법 알려줘" | Drug info / "Tell me about Tylenol dosage and effects" | Medicinas / "Háblame de la dosis y efectos del Tylenol" | Médicaments / "Parle-moi du dosage et des effets du Tylenol" |
| 코드 `fa-code` | 코드 작성 / "JavaScript로 이메일 형식 검사 함수 작성해줘" | Write code / "Write an email validation function in JavaScript" | Código / "Escribe una función de validación de email en JavaScript" | Code / "Écris une fonction de validation d'email en JavaScript" |

> es/fr 라벨은 로망스어 길이 보정을 위해 명사 한 단어로 축약(아이콘이 의미 보강). 샘플 문구는 입력창에 들어가므로 길이 무관.

---

## 컴포넌트별 변경

### 1. [src/lib/models.ts](../../src/lib/models.ts)
- 변경 없음. `CHAT_MODEL_OPTIONS`가 이미 3.5·2.5만(Lite 주석).

### 2. [components/Header.tsx](../../components/Header.tsx)
- 모델 선택기 마크업·상태(`isModelMenuOpen`, `modelMenuRef`, click-outside) **제거**.
- props `selectedModel`/`onModelChange` 제거. 모델 관련 i18n 키(`model35Flash` 등)는 ChatInput로 이동.
- 헤더를 **bare 플로팅**으로: 좌측 햄버거(모바일 `md:hidden`), 우측 아바타/프로필(현행 모달 트리거 유지). 현행 pill 배경 컨테이너 제거(프로토타입 claude 레이아웃 참고).
- 프로필 모달·다크모드 토글·아바타 로직은 그대로 유지.

### 3. [components/ChatInput.tsx](../../components/ChatInput.tsx)
- 우측 클러스터(🎤 앞)에 **모델 선택기** 추가: `CHAT_MODEL_OPTIONS` 순회, 드롭다운 위/아래 방향은 새 prop으로 제어, click-outside.
- props 추가: `selectedModel`, `onModelChange`, `welcome`(드롭다운 방향: welcome=아래`top-full`/active=위`bottom-full`), `prefill`(칩 채우기, `{ text, ts }` 형태로 같은 칩 재클릭도 재발화).
- `prefill` 효과는 기존 `editValue` 패턴([ChatInput.tsx:135](../../components/ChatInput.tsx#L135)) 재사용(setInput + focus + adjustHeight).
- 첨부 아이콘 `fa-paperclip` → `fa-plus`.
- 모델 i18n(라벨/설명) 4개 언어 추가.

### 4. components/SuggestChips.tsx (신규)
- props: `language`, `onSelect(sample: string)`.
- 위 i18n 테이블 기반 4칩 렌더. 라인 아이콘. 모바일 `overflow-x-auto`(가로 스크롤) / 데스크톱 `sm:flex-wrap sm:justify-center`.
- 칩 클릭 → `onSelect(sample)`.

### 5. [App.tsx](../../App.tsx)
- 모델 props(`selectedModel`/`onModelChange`)를 Header → **ChatInput**로 전달.
- 빈-상태(`!currentSession || messages.length === 0`)일 때:
  - 그리팅(한 줄) → **ChatInput** → **SuggestChips** 를 main 영역 **세로 중앙** 그룹으로 렌더.
  - `WelcomeMessage`는 한 줄 그리팅으로 단순화(부제 제거) 또는 인라인.
- 대화 시작(메시지 ≥1) 시: 칩·그리팅 미렌더, **ChatInput을 footer 하단**에 렌더.
- `prefill` state 추가 → SuggestChips `onSelect`가 `setPrefill({ text, ts: Date.now() })` → ChatInput에 전달.
- ChatInput에 `welcome={messages.length === 0}` 전달(드롭다운 방향).

---

## 구현 주의 / 리스크

1. **ChatInput 단일 인스턴스 vs 위치 이동**: 웰컴(중앙)↔대화중(하단)에서 ChatInput을 조건부 위치에 렌더하면 React가 언마운트/리마운트되어 입력 draft·포커스가 날아갈 수 있다. 단, 전환은 **첫 전송 시점**(입력창이 어차피 비워짐)이라 리마운트 허용 가능. 깔끔히 하려면 단일 마운트 + CSS 배치로 처리하는 방안을 구현 단계에서 검토.
2. **드롭다운 방향**: 웰컴에서 입력창이 중앙이라 위로 열면 그리팅을 가림 → 아래로. 대화중엔 하단이라 위로. `welcome` prop으로 클래스 토글(`top-full mt-2` ↔ `bottom-full mb-2`).
3. **헤더 bare 전환**: 현행 pill 제거 시 데스크톱 좌측이 비므로 우상단 아바타만 남음(의도된 디자인). 모바일 햄버거는 사이드바 토글로 유지 필수.
4. **i18n 누락 방지**: 4개 언어 모두 칩 라벨·샘플 채워야 함(프로토타입에 전부 작성됨).
5. **성능**: 칩·문구는 정적 — 추가 네트워크/번들 영향 미미.

---

## 검증 계획

- `npm run build` tsc 0.
- 빈 화면: 그리팅 한 줄 + 입력창 중앙 + 칩 4종, 모델 드롭다운 아래로, 첨부 `+`.
- 칩 클릭 → 입력창 샘플 채움 + 포커스.
- 전송/첫 메시지 → 칩·그리팅 사라지고 입력창 하단, 드롭다운 위로.
- 4개 언어 전환 시 칩 라벨·샘플·그리팅·placeholder·모델 설명 동시 전환.
- 모바일(가로 스크롤 칩)·데스크톱(wrap-center)·다크/라이트 확인.

---

## 비범위

- 칩 → 샘플 목록 팝오버(클로드식 다단계) — 단순 "칩 1개=샘플 1개"로 확정.
- 모델 옵션 확장(2.5 Lite 등).
- 사이드바/프로필/렌더러 변경.
