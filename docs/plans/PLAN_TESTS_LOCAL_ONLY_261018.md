# PLAN_TESTS_LOCAL_ONLY_261018 — tests/ 를 레포에서 빼고 로컬 전용으로

> 작성일: 2026-10-18 · 상태: 대기(시점은 사용자 결정) · 관련: [DEV_261018 §16](../logs/2026/10/DEV_261018.md#16-재발-방지--verify-에-strict-타입eslintknip)

`tests/` 는 개발 단계라 올려둔 것이다. 나중에 git 추적에서 빼고 로컬에만 둔다. 그때 아래를 같이 고치지 않으면 `verify` 와 knip 이 깨진다.

## 체크리스트

### 1. package.json 스크립트
- [ ] `test` 스크립트(`tsx tests/run-all.mts`)를 지운다
- [ ] `verify` 에서 하니스 단계(`&& npm test`)를 뺀다 → `typecheck:strict && lint -- --quiet && lint:dead`
- [ ] tests 를 참조하는 나머지 스크립트도 지운다: `audit:url-openai` · `audit:wikidocs-openai` · `audit:wikidocs-puppeteer` · `test:openai-live`(전부 `tests/manual/`)

### 2. knip.json
- [ ] `entry` 에서 `tests/*.mts` · `tests/manual/**/*.{mts,mjs,ts}` · `tests/lib/server-only-stub.ts` 를 뺀다
- [ ] 뺀 뒤 `npx knip` 을 돌린다 — **테스트에서만 쓰던 export 가 "미사용"으로 새로 잡힌다.** 하나씩 보고 지우거나(정말 안 씀) 둔다(공개 API)

### 3. devDependencies
- [ ] tests 전용 의존성을 지운다: `unified` · `remark-parse` · `remark-rehype`(`test-math-normalize` 만 직접 import)
- [ ] `tsx` 가 tests 외에 쓰이는지 확인 후 판단

### 4. 문서
- [ ] `docs/**` 와 `README.md` 의 `tests/` 링크(10-18 기준 약 78건)를 인라인 코드로 강등하거나 지운다
- [ ] 문서 링크 검사기(`tests/test-doc-links.mts`)도 함께 빠진다 — 로컬에서 돌릴지, `scripts/` 같은 다른 곳으로 옮길지 정한다
- [ ] `.gitignore` 의 tests 안내 주석(60행 부근)과 `tests/manual/fixtures/` · `tests/manual/data/` 항목을 `tests/` 한 줄로 바꾼다

### 5. 소스
- [ ] 소스 주석 문구를 검사하던 하니스(`test-paper-card` · `test-card-followup` 등)가 사라지므로, 그 주석이 지키던 불변식은 주석에만 남는다는 점을 감안한다

### 6. git
- [ ] `git rm -r --cached tests` 후 `.gitignore` 에 `tests/` 추가 — 로컬 파일은 남는다
