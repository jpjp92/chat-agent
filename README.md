
# 🚀 Chat with Gemini - Next-Gen AI Persistent Messenger

**Chat with Gemini**는 Google의 **Gemini 2.5 Flash** 엔진과 **Supabase**의 영구 저장소 기능을 결합한 지능형 AI 메신저입니다. 별도의 가입 절차 없이 즉시 시작할 수 있는 **Login-less** 경험과, 기기 간 기록이 유지되는 **Persistent History** 기능을 동시에 제공합니다.

---

## ✨ 핵심 기능 (Key Features)

### ⚡ 게스트 우선 접근 (Login-less Experience)
- **자동 익명 로그인**: 앱 실행 즉시 랜덤 닉네임과 함께 세션이 생성됩니다. 번거로운 이메일 인증이나 가입 없이 바로 대화를 시작하세요.
- **프로필 설정**: 사이드바 하단 아이콘을 통해 나만의 닉네임과 프로필 이미지를 언제든 자유롭게 설정할 수 있으며, 이는 DB에 안전하게 저장됩니다.

### 💾 영구 대화 기록 (Persistent Memory)
- **Supabase 연동**: 모든 대화와 세션은 Supabase DB에 저장되어 페이지를 새로고침하거나 기기를 변경해도 내 대화 내역이 그대로 유지됩니다.
- **세션 관리**: 대화방 생성, 삭제, 이름 변경이 자유로우며 AI가 대화 내용을 분석해 가장 적절한 제목을 자동으로 생성해줍니다.

### 🌐 완벽한 UI 현지화 (Full Localization)
- **4개국어 지원**: 한국어(KO), 영어(EN), 스페인어(ES), 프랑스어(FR)를 완벽하게 지원합니다.
- **Deep UI Localization**: 단순히 AI 응답뿐만 아니라 사이드바 삭제 확인창, 에러 메시지, 로딩 텍스트, 안내 배너 등 **모든 인터페이스**가 선택한 언어로 즉시 전환됩니다.

### 🔍 지능형 분석 및 멀티모달 (Multimodal & Analysis)
- **PDF 및 이미지 분석**: 최대 4MB의 문서를 업로드하여 Gemini에게 요약이나 데이터 추출을 요청할 수 있습니다.
- **실시간 Google 검색**: 최신 정보가 필요한 질문에는 AI가 실시간 웹 검색을 수행하고 정확한 출처(Grounding Card)를 제공합니다.
- **YouTube 하이브리드 분석**: 영상 URL만으로 자막을 분석하거나, 자막이 없는 경우 Gemini가 직접 영상을 "시청"하여 내용을 분석합니다.

---

## 🏗️ 기술 스택 (Tech Stack)

### Frontend
- **React 19** + **Vite** (TypeScript)
- **Tailwind CSS** (Premium Responsive Design)
- **Lucide / FontAwesome** (Iconography)

### Backend & Database
- **Vercel Serverless Functions** (API Layer)
- **Supabase** (PostgreSQL / Storage / Auth)
- **Vercel Edge API Requests** (Fast Processing)

### AI Core
- **Chat**: `gemini-2.5-flash` (Primary Next-Gen Model)
- **Summarization**: `gemma-3-4b-it` (Topic & Title Generation)
- **Speech**: `gemini-2.5-flash-preview-tts` (High-Quality Voice)

---

## 📁 프로젝트 구조 (Project Structure)

```
.
├── api/                   # Vercel Serverless Functions (Backend)
│   ├── auth.ts           # 익명 로그인 및 사용자 프로필 관리
│   ├── chat.ts           # Gemini 스트리밍 대화 로직 (로테이션 포함)
│   ├── upload.ts         # Supabase Storage 파일 업로드 프록시
│   ├── sessions.ts       # 채팅 세션 및 메시지 CRUD
│   ├── speech.ts         # 고품질 음성 합성 (TTS)
│   ├── fetch-url.ts      # 실시간 웹/Arxiv 데이터 추출
│   ├── fetch-transcript.ts # YouTube 자막 추출 서비스
│   ├── summarize-title.ts # Gemma 기반 인텔리전트 제목 생성
│   └── lib/
│       └── supabase.ts   # 서버사이드 Supabase 클라이언트 설정
├── components/            # UI 컴포넌트 (현지화 로직 포함)
│   ├── ChatSidebar.tsx   # 대화 목록, 필터링 및 언어 설정
│   ├── ChatInput.tsx     # 멀티모달 입력 및 용량 검증
│   ├── Dialog.tsx        # 프리미엄 커스텀 모달 (확제 확인 등)
│   ├── ChatMessage.tsx   # 마크다운 렌더링 및 시각화
│   ├── Header.tsx        # 유저 프로필 및 전역 설정
│   └── Toast.tsx         # 알림 피드백 시스템
├── services/
│   └── geminiService.ts  # 프론트엔드 API 인터페이스 및 오디오 제어
├── App.tsx                # 중앙 상태 관리 및 전체 레이아웃
├── types.ts               # 글로벌 TypeScript 타입 정의
├── vercel.json            # 배포 구성 설정
├── tailwind.config.ts     # 디자인 시스템 테마 설정
└── package.json           # 의존성 및 스크립트 관리
```

---

## 🔐 보안 및 안정성 (Security & Stability)

- **API 키 로테이션**: 5개의 API 키를 Round-Robin 방식으로 사용하여 429(Too Many Requests) 에러를 최소화합니다.
- **RLS(Row Level Security)**: Supabase의 행 수준 보안 정책을 통해 사용자는 본인의 대화 데이터에만 접근할 수 있도록 설계되었습니다.
- **서버사이드 처리**: API 키와 비밀 세크릿은 브라우저에 절대 노출되지 않으며 Vercel 서버 내부에서만 사용됩니다.
- **Infrastructure limits**: Vercel Serverless 제한(4.5MB Payload)을 고려한 지능형 에러 핸들링 및 업로드 최적화가 적용되어 있습니다.

---

## 🚀 시작하기 (Getting Started)

### 1. 환경 변수 설정 (.env.local)
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
API_KEY=your_gemini_key_1
API_KEY2=your_gemini_key_2
...
```

### 2. 설치 및 실행
```bash
npm install
npm run dev
```

---

Developed by **jpjp92**  
*Powered by Google Gemini & Supabase Persistent Memory Systems*
