# Law-Viz: Test Prompt Guide

Reference prompts for testing the `json:law` renderer and the Korean statute lookup pipeline (국가법령정보센터 Open API).

> 기술 상세(API 구조·스크립트·주의사항): [`LAW_API_TEST.md`](LAW_API_TEST.md)

---

## Renderer Schema

### mode: list — 법령 목록

```json
{
  "query": "도로교통법",
  "mode": "list",
  "count": 5,
  "laws": [
    {
      "name": "도로교통법",
      "shortName": "도교법",
      "lawId": "LSW0000400",
      "mst": "123456",
      "type": "법률",
      "department": "경찰청",
      "promulgationDate": "20230101",
      "effectiveDate": "20230401",
      "revisionType": "일부개정",
      "status": "현행",
      "sourceUrl": "https://www.law.go.kr/..."
    }
  ]
}
```

### mode: body — 법령 본문 (주요 조문)

```json
{
  "query": "음주운전 기준",
  "mode": "body",
  "law": { "name": "도로교통법", "mst": "123456" },
  "articles": [
    {
      "number": "44",
      "title": "술에 취한 상태에서의 운전 금지",
      "clauses": [
        { "number": "1", "text": "누구든지 술에 취한 상태에서 자동차등...을 운전하여서는 아니 된다." },
        { "number": "2", "text": "경찰공무원은 교통의 안전과 위험방지를 위하여..." }
      ],
      "sourceUrl": "https://www.law.go.kr/..."
    }
  ]
}
```

### mode: article — 특정 조문

```json
{
  "query": "도로교통법 제44조",
  "mode": "article",
  "law": { "name": "도로교통법", "mst": "123456" },
  "articleNo": "44",
  "articles": [
    {
      "number": "44",
      "title": "술에 취한 상태에서의 운전 금지",
      "clauses": [...],
      "sourceUrl": "https://www.law.go.kr/..."
    }
  ]
}
```

---

## 1. 법령 목록 검색 (mode: list)

- "도로교통법 관련 법령 목록 보여줘"
- "개인정보 보호법 법령 목록 찾아줘"
- "근로기준법 관련 법령 검색해줘"
- "민법 관련 법령 목록"
- "소방법 관련 법안 찾아줘" — 통칭 `소방법` → `소방기본법` 보정

## 2. 특정 조문 조회 (mode: article)

- "도로교통법 제44조 알려줘" — 술에 취한 상태에서의 운전 금지
- "민법 제1조 내용 보여줘" — 법원
- "개인정보 보호법 제15조 정리해줘" — 개인정보의 수집·이용
- "근로기준법 제56조 알려줘" — 연장·야간·휴일 근로 가산임금
- "상법 제398조 내용" — 이사 등과 회사 간의 거래
- "형법 제250조 알려줘" — 살인

## 3. 주제형 질의 — 관련 조문 묶음 (mode: body)

- "도로교통법 신호위반 조항 정리해줘" — 제5조·제156조 관련 조항
- "도로교통법 음주운전 기준 알려줘" — 제44조·제148조의2
- "개인정보 보호법 개인정보 수집 동의 관련 조항"
- "근로기준법 연장근로 수당 관련 조항"
- "정보통신기반 보호법 주요 조항 보여줘"

## 4. 통칭 법령명 자동 보정

| 입력 | 실제 검색 |
|------|-----------|
| "소방법" | `소방기본법`, `소방` |
| "교통법" | `도로교통법` |
| "개인정보법" | `개인정보 보호법` |
| "근로법" | `근로기준법` |

---

## Tips

- **mode 분기**: 법령명 + 조번호 → `article`, 주제형 키워드 → `body`, 목록 요청 → `list`
- **조문 accordion**: 첫 번째 조문 기본 펼침, 나머지는 접힘 상태
- **페이지네이션**: 조문 5개 초과 시 하단 `이전/다음`으로 5개씩 탐색
- **원문 링크**: 각 조문 카드에 `law.go.kr` 공식 원문 링크 — `LAW_OC`를 외부에 노출하지 않음
- **현재 미지원 범위**: 판례, 헌재결정례, 행정규칙, 고시, 신구법 비교, 별표·서식 → TODO Phase 2~4
