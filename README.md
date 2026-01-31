
# 🚀 Chat with Gemini - Next-Gen AI Persistent Messenger

**Chat with Gemini** is an intelligent AI messenger that combines the power of Google's **Gemini 2.5 Flash** engine with **Supabase** persistent storage. It offers a seamless **Login-less** experience while maintaining **Persistent History** across devices.

---

## ✨ Key Features

### ⚡ Login-less Experience (Guest-First)
- **Automatic Anonymous Auth**: Start chatting immediately with a random nickname and profile. No tedious sign-up or email verification required.
- **Profile Customization**: Easily set your custom nickname and avatar from the sidebar. All profile data is saved securely in the cloud.

### 💾 Persistent Conversation History
- **Supabase Integration**: All messages and sessions are stored in Supabase (PostgreSQL). Your chat history remains intact even after a page refresh or device change.
- **Intelligent Session Management**: Create, delete, and rename chat sessions. An AI-powered titling system (using Gemma 3) automatically generates representative titles for your conversations.

### 🌐 Comprehensive Deep Localization
- **Multi-language Support**: Fully supports **English (EN)**, **Korean (KO)**, **Spanish (ES)**, and **French (FR)**.
- **Visualizer Localization**: All visualization modules (Bio, Chemical, Charts) automatically localize their UI labels (e.g., "Chain", "Molecular Structure", "Analyzing...") based on the global setting.
- **Strict Response Enforcement**: Optimized system prompts ensure Gemini adheres to the selected language regardless of input language.

### 🔍 Intelligence & Multimodality
- **PDF & Image Analysis**: Upload documents (PDF) or images and ask Gemini to summarize, extract data, or describe visual content (up to 4MB).
- **Real-time Google Search**: For time-sensitive queries, the AI performs a live web search and provides accurate **Grounding Cards** with source citations.
- **Hybrid YouTube Analysis**: Paste a YouTube URL to extract summaries. If captions are missing, Gemini can "watch" and analyze the video content directly.

### 📊 Intelligent Data, Chemical & Biological Visualization (Upgraded!)
- **Advanced Dynamic Charts**: Support for 8+ visualization types: **Bar, Line, Area, Pie, Donut, Scatter, Radar, and Treemap**.
- **Chemical Structure Rendering**: Asking about molecules (e.g., Caffeine, Aspirin) renders precise structures with **SMILES** support. Now includes **Molecule Naming** and **SVG Export**.
- **Bioinformatics Visualization (Bio-Viz)**: 
    - **3D Protein Structure**: Immersive rendering of PDB structures using **NGL Viewer** with high-quality cartoon representations.
    - **Intelligent Tracking**: Real-time **Residue Tracking** (#number) with fixed-position Glassmorphic Tooltips. 
    - **Large Scale Support**: Optimized for massive assemblies like **Connexin Channels** (e.g., 2ZW3) with multi-chain color differentiation.
    - **WebGL Optimization**: Explicit context disposal (dispose) and robust event listener management.
- **Result Export**: High-quality **Snapshot (PNG)** and **SVG Download** support with white-background compatibility for external reports.
- **Smart Parsing & Logic**: Real-time detection with sleek **loading skeletons**. Robustly handles inconsistent JSON and missing values (null/NaN).

### 🎨 Mobile & UX Enhancements
- **Drag & Drop and Paste**: Simply paste (Ctrl+V) images or drag files directly into the chat area. A sleek overlay guides your upload.
- **Advanced Document Support**: Directly analyzes `.docx`, `.hwpx`, `.pptx`, `.xlsx`, `.txt`, `.md`, and `.csv` using client-side text extraction (via Mammoth & JSZip), bypassing API MIME restrictions.
- **Premium LaTeX Rendering**: Optimized mathematical expressions with **KaTeX**. Features **Mobile-optimized horizontal scrolling**, neutral professional aesthetics, and distinct inline/block styling.
- **Mobile-First Design**: Optimized for mobile browsers with **Dynamic Viewport Height (100dvh)** and horizontal scroll support for all visualization types.

---

## 🗺️ System Architecture

```mermaid
flowchart TB
    User([👤 User])
    
    subgraph Frontend["🎨 Frontend Layer"]
        UI[React UI Components]
        subgraph Viz["📊 Visualization Engines"]
            Apex[ApexCharts - 8+ Types]
            SMILES[smiles-drawer - Chemical]
            NGL[NGL - 3D Protein Structures]
            KaTeX[KaTeX - Math Expressions]
        end
        State[Session State Management]
    end
    
    subgraph Backend["⚙️ Vercel Serverless API"]
        Auth[/api/auth - Anonymous Login/]
        Chat[/api/chat - Streaming/]
        Sessions[/api/sessions - CRUD/]
        Upload[/api/upload - Storage Proxy/]
        Tools[/api/fetch-url, /api/speech/]
    end
    
    subgraph AI["🤖 AI Engine"]
        Gemini["Gemini 2.5 Flash<br/>(Multimodal Reasoning)"]
        Gemma["Gemma 3 4B<br/>(Title Generation)"]
        TTS["Gemini 2.5 Flash Preview TTS<br/>(Premium Speech)"]
    end
    
    subgraph Storage["💾 Persistent Storage"]
        DB[(Supabase PostgreSQL<br/>Sessions & Messages)]
        Files[Supabase Storage<br/>Images & PDFs]
    end
    
    subgraph Parser["📄 Client-side Parsers"]
        HWPX[JSZip - HWPX]
        DOCX[Mammoth - DOCX]
        XLSX[SheetJS - XLSX]
    end
    
    User -->|Query + Files| Frontend
    Frontend -->|API Calls| Backend
    Backend -->|Requests| AI
    AI -->|Streaming/Audio/Title| Backend
    Backend <-->|Store/Retrieve| Storage
    Frontend -->|Extract Text| Parser
    Parser -->|Context| Backend
    AI -->|Grounded Response| Backend
    Backend -->|Real-time Stream| UI
    UI -->|JSON Blocks| Viz
    Viz -->|SVG/Canvas| UI
    UI -->|Display| User
```

---

### Frontend
- **React 19** + **Vite** (TypeScript)
- **ApexCharts** (Data Visualization)
- **smiles-drawer** (Chemical Structure Rendering)
- **ngl** (3D Biological Visualization)
- **Tailwind CSS** (Premium Responsive Design)
- **Framer Motion** (Immersive Animations)

### Backend & Database
- **Vercel Serverless Functions** (API Layer)
- **Supabase** (PostgreSQL / Storage / Auth)

### AI Models
- **Chat**: `gemini-2.5-flash` (Next-generation high-speed multimodal model)
- **Summarization**: `gemma-3-4b-it` (High-efficiency title generation)
- **Speech**: `gemini-2.5-flash-preview-tts` (Premium natural-sounding voice)

---

## 📁 Project Structure

```
.
├── api/                   # Vercel Serverless Functions (Backend)
│   ├── auth.ts           # Anonymous login & Profile management
│   ├── chat.ts           # Gemini streaming logic (w/ Key Rotation & Viz Prompts)
│   ├── upload.ts         # Supabase Storage proxy for file uploads
│   ├── sessions.ts       # Chat session & Message CRUD
│   ├── speech.ts         # Text-to-Speech (TTS) service
│   ├── fetch-url.ts      # Real-time Web/Arxiv scraping
│   ├── fetch-transcript.ts # YouTube subtitle fetching
│   ├── summarize-title.ts # Intelligent titling via Gemma
│   └── lib/
│       └── supabase.ts   # Server-side Supabase client config
├── components/            # UI Components (Localized)
│   ├── ChatSidebar.tsx   # Session list & Language settings
│   ├── ChatInput.tsx     # Multimodal input & text extraction
│   ├── ChatMessage.tsx   # Markdown, Math & Viz block parsing
│   ├── ChartRenderer.tsx # Multi-type ApexCharts (Exportable)
│   ├── ChemicalRenderer.tsx # SMILES visualization (Named, Exportable)
│   ├── BioRenderer.tsx   # 3D structure & 1D sequence viewer (NGL)
│   ├── Dialog.tsx        # Premium custom modals
│   ├── Header.tsx        # User profile & global settings
│   └── Toast.tsx         # Notification feedback system
├── services/
│   └── geminiService.ts  # Frontend API bridge & audio control
├── App.tsx                # Central state & main layout
├── index.html             # Global CSS & KaTeX configs
└── types.ts               # Global types & interfaces
```

---

## 🔐 Security & Reliability

- **API Key Rotation**: Utilizes up to 5 API keys in a Round-Robin fashion to minimize **429 (Too Many Requests)** errors and ensure uptime.
- **Row Level Security (RLS)**: Enforced via Supabase to ensure users can only access their own private conversation data.
- **Server-side Secrecy**: All sensitive credentials and API keys are stored in environment variables and never exposed to the client-side browser.
- **Payload Optimization**: Includes intelligent handling for Vercel's 4.5MB payload limit to prevent deployment-specific upload failures.

---

## 🚀 Getting Started

### 1. Configure Environment Variables (.env.local)
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
API_KEY=your_gemini_key_1
API_KEY2=your_gemini_key_2
...
```

### 2. Install & Run
```bash
npm install
npm run dev
```

---

Developed by **jpjp92**  
*Powered by Google Gemini & Supabase Persistent Memory Systems*
