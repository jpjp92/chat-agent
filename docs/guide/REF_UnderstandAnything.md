# REF_UnderstandAnything — Understand-Anything 플러그인 가이드

> 작성일: 2026-05-26  
> 플러그인: [Lum1104/Understand-Anything](https://github.com/Lum1104/Understand-Anything) ⭐ 32k

---

## 설치

```bash
claude plugin marketplace add Lum1104/Understand-Anything
claude plugin install understand-anything
```

---

## 주요 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/understand` | 코드베이스 전체 분석 → `.understand-anything/knowledge-graph.json` 생성 |
| `/understand-dashboard` | 브라우저에서 인터랙티브 그래프 탐색 |
| `/understand-chat <질문>` | 코드 구조에 대해 자연어로 질문 |
| `/understand-diff` | 현재 변경사항의 파급 범위 분석 |
| `/understand-domain` | 비즈니스 도메인 뷰 (도메인 → 플로우 → 스텝) |
| `/understand-explain <파일>` | 특정 파일/함수 상세 분석 |
| `/understand-onboard` | 신규 팀원용 온보딩 가이드 생성 |

---

## chat-agent 활용 예시

```bash
# LangGraph agent 구조 파악
/understand-chat How does the intent routing flow work?

# server/ 리네임 후 파급 범위 확인
/understand-diff

# 특정 툴 분석
/understand-explain server/agent/nodes/generator.ts

# 도메인 뷰로 약국/병원/법령 툴 흐름 파악
/understand-domain
```

---

## 증분 분석

```bash
# 변경된 파일만 재분석 (기본값)
/understand

# 전체 재분석 강제
/understand --full
```
