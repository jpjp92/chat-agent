# PLAN: theater-branches.json 데이터 관리 정비

> 작성일: 2026-06-27
> 관련: [REF_Movie.md](../guide/REF_Movie.md), [lib/theaters.ts](../../lib/theaters.ts), `scripts/test-branch-list.mjs`

---

## 배경 — DB로 옮길까?

질문: `data/theater-branches.json`(532지점, 57KB)을 Supabase에 넣고 런타임에 꺼내쓰는 게 나은가?

**결론: 아니오. 정적 번들 유지가 정답.**

현재 [lib/theaters.ts:10](../../lib/theaters.ts#L10)이 `import branchesRaw from '../data/theater-branches.json'`로 **빌드 타임에 JS 번들에 박는다.** 런타임 비용 0(네트워크 없음, 동기 메모리 연산).

| 소비처 | 지금 | DB로 옮기면 |
|---|---|---|
| [movie-tool.ts:17](../../server/agent/movie-tool.ts#L17) `defaultsForRegion()` | 0ms | 영화 질의마다 Supabase 왕복 +50~150ms(콜드 더), 그것도 60s 캡 함수 크리티컬 패스 |
| [MovieRenderer.tsx:170](../../components/MovieRenderer.tsx#L170) `flatBranches()` | 즉시 렌더 | 네트워크 fetch + 로딩 상태 |

DB가 정당한 3조건(① 재배포 없이 갱신 ② 대용량 ③ 다중 서비스 공유) 모두 해당 안 됨 — 지점은 연 몇 번 변동, 57KB, 이 앱 단독 사용. 번들 import가 **이미 궁극의 캐시**라 DB는 실패 표면·지연만 추가.

→ 실질 이슈는 레이턴시가 아니라 **갱신 파이프라인과 데이터 품질**. 이 문서는 그쪽을 정비한다.

---

## 현재 구조의 구멍

1. **출력 경로 불일치(수동 복사)**: 생성 스크립트는 `scripts/movie-spike-output/branches.json`에 쓰는데, 소비되는 파일은 `data/theater-branches.json`. 갱신 때마다 수동 복사가 끼어들고 문서화도 안 됨 → 까먹기 쉬움.
2. **갱신 명령/주기 부재**: `npm run` 스크립트 없음, "언제 갱신하나"도 미기록.
3. **데이터 품질 버그(메가박스)**:
   - `brchNo 0084: "href"` — 스크래퍼가 지점명 대신 `href` 속성을 잘못 캡처한 쓰레기 엔트리
   - `창동(영업종료)`, `픽쳐하우스(휴관)` 등 **폐점/휴관 지점**(5건)이 드롭다운 선택 후보로 남음 → 선택 시 상영표 빈 결과
4. **HTML 엔티티 잔존**: `nm`에 `&#40;`/`&#41;`(괄호) 등이 그대로 저장돼 런타임 [decode()](../../lib/theaters.ts#L41)에 의존. (인코딩 자체는 정상 UTF-8 — 깨짐 없음 확인됨)

---

## 수정 계획

### ① 생성 스크립트가 `data/`에 직접 쓰기 (원자적 + sanity 게이트)

`scripts/test-branch-list.mjs`:
- 출력 대상을 `data/theater-branches.json`으로 변경. **임시 파일에 쓰고 검증 통과 시 rename**(부분 실패가 기존 정상 데이터를 덮지 않게).
- **sanity 게이트**: 스크랩 결과가 임계치 미만이면 **쓰지 않고 exit 1**.
  - 기준(현재 177/239/116 대비 ~-15% 허용): `cgv ≥ 150`, `lotte ≥ 200`, `mega ≥ 100`.
- 디버그용 raw 사본은 기존처럼 `scripts/movie-spike-output/branches.json`에도 남김(선택).

### ② 생성 시 정규화 (data/ 파일을 깨끗하게)

스크립트 내 write 직전:
- HTML 엔티티 디코드(`&#40;`→`(` 등) — `data/`에 클린 텍스트 저장. (lib의 `decode()`는 방어적 폴백으로 유지)
- **쓰레기 필터**: `nm === 'href'` / 빈 값 / 한글·영숫자 없는 항목 제거.
- **폐점 필터**: `nm`에 `영업종료`(영구 폐점) 포함 시 제거. `휴관`(임시)은 라벨 유지하고 남김.

### ③ 갱신 = 로컬 전용 스크립트

생성 스크립트(`scripts/test-branch-list.mjs`)는 `.gitignore`의 `scripts/test-*`로 **레포 미포함, 로컬 전용 도구**. 커밋되는 산출물은 `data/theater-branches.json`(데이터)뿐. (사용자 결정 2026-06-27: package.json `npm run refresh:theaters`는 커밋된 파일이 미추적 스크립트를 가리키는 모순이라 **제거**, 직접 실행으로 통일.)
```bash
node scripts/test-branch-list.mjs   # 로컬 전용 → data/theater-branches.json 갱신(게이트 통과 시)
```

### ④ 문서화

[REF_Movie.md](../guide/REF_Movie.md)에 "지점 데이터 갱신" 섹션 추가:
- 갱신 명령(`node scripts/test-branch-list.mjs`, 로컬 전용)
- 갱신 시점(분기 1회 또는 카드에서 지점 빠짐 신고 시)
- `BROWSERLESS_KEY` 필요(CGV browserless), sanity 게이트 동작

### ⑤ 지역 그룹 정리 (멀티턴 "서울 중곡동" 오분류 계기)

영화 카드의 지역→지점 해석이 **지점명 부분일치**라, 동네명(중곡동)이 매칭 실패 시 강남으로 폴백되고 "서울"이 "서울대입구"에 오매칭되는 한계. 근본 개선엔 체인별 지역 그룹 메타가 필요.

**현황 분석 (2026-06-27):**
- **CGV**: 9개 그룹이 지역순으로 정렬돼 있으나 `region` 필드가 전부 빈 값(스크래퍼 `r.regnNm`이 빈 응답). 대표 지점으로 추론: `서울/경기/인천/강원/충청/대구/부산/경상/전라`.
- **롯데**: `code` 중간 세그먼트(DetailDivision)가 지역 인코딩(1=서울, 2=경기·인천, 3=충청, 4=전라, 5=대구·경북, 6=강원, 7=제주, 101=부산·경남). **단 DivisionCode 2(롯데시네마(2))는 동일 지점 특별관 재등록 = 전부 중복(239→133, 고유 손실 0).**
- **메가**: `brchNo` 앞자리가 지역 근사(0/1=수도권, 2=강원, 3=충청, 4=경기, 5=전라, 6=부산, 7=대구·경북). 정확 지역은 스크랩 시 `data-area-cd` 필요.

**Phase 1·2 — 완료 (재스크랩 불필요, 결정적):**
- ✅ **롯데 중복 제거**: data + scraper(`DivisionCode === 1`만 유지) → 239→133. 드롭다운 노이즈 해소. sanity 게이트 lotte 200→115 조정.
- ✅ **3체인 region 전체 채움** (data + scraper):
  - CGV: 9그룹 인덱스 → `서울/경기/인천/강원/충청/대구/부산/경상/전라`. 스크래퍼는 `regnNm`(빈 응답) 우선, 없으면 인덱스 fallback.
  - 롯데: `code` 중간 세그먼트 → `1=서울,2=경기,3=충청,4=전라,5=대구,6=강원,7=제주,101=부산`. (데이터만으로 결정적)
  - 메가: `/theater/list`의 `class="sel-city">{지역}` 헤더 사이 brchNo에 지역 부여(직접 fetch, browserless 불필요). 미매핑 0.
  - 타입: [lib/theaters.ts](../../lib/theaters.ts) `BranchesFile`에 lotte/mega `region?` 추가.
- 최종 카운트: CGV 177 · 롯데 133 · 메가 114 = **424**.

**Phase 3 — 후속 (선택):**
- **region-aware 매칭**: [lib/theaters.ts](../../lib/theaters.ts) `findDefaultBranch` — 이름 부분일치 실패 시 시/도 그룹으로 폴백. 단 **사용자 결정: 폴백은 강남 유지 + 드롭다운에서 선택 안내** → region은 메타로 보관, 최종 보정은 드롭다운에 위임. (지금 매칭 로직 변경 안 함)
- **드롭다운 지역 그룹핑**: MovieRenderer에서 region별 섹션 표시(선택).

---

## 비범위 (하지 않음)

- **DB 이전** — 위 배경 참조, 손해.
- **GitHub Actions cron 자동 갱신** — browserless 비용 + CI 시크릿 + 유지보수가 연 몇 번 변동 데이터엔 과함. 필요 시 후속.
- **클라이언트 lazy-load 분리** — 57KB는 365KB 번들 대비 미미. 지금 불필요.

---

## 검증

- `node scripts/test-branch-list.mjs` → 개수 로그 + `data/` 갱신, mega에 `href`/`영업종료` 없음 확인.
- 게이트 테스트: 스크랩 일부 실패(빈 배열) 시 기존 파일 보존 + exit 1.
- `npm run build` tsc 0, 영화 카드 기본 지점/드롭다운 정상.
