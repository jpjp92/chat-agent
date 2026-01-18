
# 🚀 Chat with Gemini - Intelligent Real-time AI Messenger

**Chat with Gemini**는 Google의 최신 **Gemini** 엔진과 **실시간 Google 검색(Grounding)** 기능을 결합한 차세대 지능형 챗봇입니다. 사용자 경험(UX)을 극대화하기 위해 Gemini 공식 웹 스타일을 계승하고, 강력한 시각화 기능을 탑재했습니다.

---

## ✨ 핵심 기능 (Key Features)

### 🎨 프리미엄 UI/UX (Premium Design)
- **Gemini 공식 스타일 반영**: 배경색(#131314)부터 사용자 말풍선, AI 응답의 투명한 레이아웃까지 공식 웹 버전의 감성을 그대로 구현했습니다.
- **커스텀 디자인 시스템 (Dialog & Toast)**: 투박한 브라우저 기본 알림창(alert, confirm)을 제거하고, 유리 질감(Glassmorphism)과 부드러운 애니메이션이 적용된 **프리미엄 커스텀 모달 및 토스트** 시스템을 구축했습니다.
- **슬림 & 콤팩트 디자인**: 사용자 피드백을 반영하여 채팅창의 높이와 여백을 최적화하여 더 넓고 쾌적한 화면 구성을 제공합니다.
- **지능형 표(Table) 렌더링**: 데이터 비교 요청 시 깨지지 않는 깔끔한 그리드 스타일과 반응형 레이아웃을 제공합니다.

### 🌐 글로벌 다국어 지원 (Multi-language)
- **4개국어 완벽 지원**: 한국어(KO), 영어(EN), 스페인어(ES), 프랑스어(FR)를 지원하며, 각 언어별 맞춤형 환영 메시지와 시스템 인스트럭션을 제공합니다.

### � 보안 강화 (Enhanced Security)
- **서버사이드 API 키 관리**: 모든 API 키는 Vercel Serverless Functions에서만 사용되며, 클라이언트(브라우저)에 절대 노출되지 않습니다.
- **안전한 백엔드 아키텍처**: `/api/chat`, `/api/summarize-title`, `/api/speech`, `/api/fetch-url` 엔드포인트를 통해 모든 AI 처리를 서버에서 수행합니다.

### 🛡️ 무중단 서비스 및 안정성 (Stability & Reliability)
- **펜타 API 키 로테이션 (5x Key Rotation)**: `API_KEY`부터 `API_KEY5`까지를 순차적으로 사용하는 Round-Robin 로직을 통해 할당량 초과(429) 문제를 극도로 낮췄습니다.
- **지능형 모델 폴백 (Model Fallback)**: 서버에서 자동으로 여러 API 키와 모델을 시도하여 안정성을 보장합니다.
- **사용자 친화적 에러 처리**: 모든 키가 한도에 도달했을 때, 기술적인 에러 코드 대신 설정된 언어에 맞춰 "잠시 후 다시 시도해주세요"라는 메시지를 안내합니다.

### 🔍 실시간 지식 엔진 (Search Grounding)
- **실시간 Google 검색**: 최신 뉴스, 날씨, 기술 트렌드를 AI가 실시간으로 검색하여 답변합니다.
- **출처 링크 카드**: 답변 하단에 참고한 실제 웹사이트의 파비콘과 제목, 링크를 투명하게 공개합니다.
- **URL 직접 분석**: 서버사이드 스크래핑을 통해 YouTube, Arxiv 논문, 일반 웹페이지의 내용을 직접 추출하여 정확한 답변을 제공합니다.

### 🎙️ 멀티모달 인터페이스
- **음성 합성 (TTS)**: `gemini-2.5-flash-preview-tts` 모델을 통해 고품질 음성으로 답변을 읽어줍니다.
- **모바일 완벽 지원**: 아이폰 Safari 등 모바일 브라우저의 오디오 정책을 준수하는 **AudioContext Unlock** 로직을 적용하여 스피커 아이콘 클릭 시 즉시 소리가 나도록 최적화했습니다.
- **시각 지능**: 업로드된 이미지를 분석하고 텍스트를 인식하여 복합적인 질문에 답변합니다 (최대 4MB 제한).
- **YouTube 스마트 하이브리드 분석 (Smart Hybrid)**: 
  - **자막 분석 (Fast Path)**: 자막이 있는 영상은 3초 이내에 내용을 추출하여 분석합니다.
  - **비디오 시청 (Fallback Path)**: 자막이 없는 경우 Gemini가 직접 영상을 시청하고 시각적/청각적 정보를 심층 분석합니다 (~1분 소요).

### ⚡ 성능 및 최적화 (Optimization)
- **INP(Interaction to Next Paint) 문제 해결**: `useLayoutEffect`를 사용하여 타이핑 시 발생하는 레이아웃 계산 지연을 제거했습니다. 긴 문장을 입력할 때도 끊김 없는 매끄러운 반응 속도를 보장합니다.
- **고효율 레이아웃**: 매 입력마다 발생하는 불필요한 스타일 재계산을 최소화하여 저사양 기기에서도 안정적으로 작동합니다.

### 🏷️ 사용자 편의 기능
- **인라인 타이틀 편집**: 사이드바의 채팅 제목을 더블 클릭하여 즉시 수정할 수 있습니다.
- **상세 로딩 상태**: "자막 분석 중...", "영상 시청 중..." 등 현재 AI가 수행 중인 작업을 투명하게 표시합니다.

---

## 🛠️ 배포 및 설정 (Deployment)

이 프로젝트는 **Vercel** 환경에 최적화되어 있습니다.

### 1. API 키 준비
- [Google AI Studio](https://aistudio.google.com/app/apikey)에서 API 키를 발급받으세요.
- 안정적인 서비스를 위해 최소 2개 이상의 API 키를 권장합니다.

### 2. Vercel 환경 변수 설정
Vercel 프로젝트 설정에서 Gemini **API_KEY**를 추가하세요. (안정적인 서비스를 위해 다수의 키 등록을 권장합니다.)

### 3. 배포
```bash
# 의존성 설치
npm install

# 로컬 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
```

---

## 🏗️ 기술 스택 (Tech Stack)

### Frontend
- **React 19** with TypeScript
- **Tailwind CSS** for styling
- **Vite** for build tooling

### Backend (Vercel Serverless Functions)
- **`/api/chat`**: Streaming chat with `gemini-2.5-flash`
- **`/api/summarize-title`**: Title generation with `gemma-3-4b-it`
- **`/api/speech`**: Text-to-Speech with `gemini-2.5-flash-preview-tts`
- **`/api/fetch-url`**: Server-side web scraping (YouTube oEmbed, Arxiv, general web)
- **`/api/fetch-transcript`**: YouTube subtitle fetching via `youtube-transcript-plus`

### AI Models
- **Chat**: `gemini-2.5-flash` (primary)
- **Title Summarization**: `gemma-3-4b-it`
- **Text-to-Speech**: `gemini-2.5-flash-preview-tts`
- **Tools**: `googleSearch` for real-time grounding

### Other Technologies
- **ReactMarkdown** with Remark GFM for rich text rendering
- **@google/genai** SDK v1.34.0
- **Vercel** for deployment and serverless functions

---

## 📁 프로젝트 구조 (Project Structure)

```
app_chat-1/
├── api/                      # Vercel Serverless Functions
│   ├── chat.ts              # Streaming chat endpoint
│   ├── summarize-title.ts   # Title generation endpoint
│   ├── speech.ts            # TTS endpoint
│   ├── fetch-url.ts         # Web scraping endpoint
│   └── fetch-transcript.ts  # YouTube transcript endpoint
├── components/              # React components
├── services/               
│   └── geminiService.ts    # Frontend service layer (API bridge)
├── App.tsx                 # Main application component
├── types.ts                # TypeScript type definitions
└── vercel.json             # Vercel configuration
```

---

## 🔐 보안 고려사항 (Security Considerations)

- ✅ **API 키는 절대 클라이언트에 노출되지 않습니다**
- ✅ 모든 AI 처리는 Vercel Serverless Functions에서 수행됩니다
- ✅ 환경 변수를 통한 안전한 키 관리
- ✅ CORS 정책 준수 및 서버사이드 스크래핑

---

Developed by **jpjp92**  
*Powered by Google Gemini Next-Gen Intelligence*
