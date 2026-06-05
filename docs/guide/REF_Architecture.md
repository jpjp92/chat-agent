# REF: Architecture Diagrams

> Detailed architecture diagrams referenced from [README §2. Architecture](../../README.md#2-architecture).
> The README keeps two core diagrams inline (Agent & Tool Overview flowchart, Tool-Calling Loop sequence); the rest live here.

---

## LangGraph Agent Flow

High-level StateGraph node flow (router → vision/generator → tools → output).

```mermaid
flowchart TB
    User([User Prompt])

    subgraph StateGraph ["LangGraph.js StateGraph"]
        StateNode[("AgentState")]
        RouterNode{{"🧭 Semantic Router\n(10+ Intents)"}}
        Vision["👁️ Vision Node\n(Pill image analysis)"]
        Tools["🛠️ Tool Executor\n(MFDS / Pharmacy / Hospital / Vet / Law / DDG)"]
        Generator["📝 Generator Node\n(Gemini LLM)"]
    end

    Output([Streaming Response])

    User --> StateNode --> RouterNode
    RouterNode -- "drug_id (pill+image)" --> Vision --> Generator
    RouterNode -- "all other intents" --> Generator
    Generator -- "tool_calls (drug_info/pharmacy/hospital/vet/law)" --> Tools --> Generator
    Generator --> Output
```

---

## Agent Runtime Branches

The two execution paths inside `generator.ts` (SDK path vs LangChain path). See the README for the branch rules.

```mermaid
flowchart TB
    Intent["Router intent"]
    SDK["SDK path\n@google/genai"]
    LC["LangChain path\nChatGoogleGenerativeAI"]
    GoogleSearch{"Google Search?"}
    Stage1["Stage 1\n2.5 Flash + Search"]
    Stage2["Stage 2\n3.5 Flash synthesis"]
    Single["Single-pass response"]
    ToolCall{"AIMessage.tool_calls?"}
    Tools["ToolNode executes tool"]
    Final["Final response"]

    Intent --> SDK
    Intent --> LC
    SDK --> GoogleSearch
    GoogleSearch -- "3.5 + search required" --> Stage1 --> Stage2 --> Final
    GoogleSearch -- "no / 2.5 search" --> Single --> Final
    LC --> ToolCall
    ToolCall -- "yes" --> Tools --> LC
    ToolCall -- "no" --> Final
```

---

## URL Prefetch And Fallback Flow

Exact URL prompts are fetched before `/api/chat` so the generator can use the page body as the primary source and disable Google Search for that turn.

```mermaid
flowchart TB
    Prompt["User prompt with URL"]
    Stream["useChatStream"]
    FetchURL["/api/fetch-url\nnodejs runtime, maxDuration 60"]
    Direct["Direct HTML fetch\n10s"]
    Jina["Jina reader fallback\n20s"]
    Scraper["ScraperAPI render fallback\nwikidocs only, 52s"]
    Content["[URL_CONTENT]\npage text injected into webContent"]
    Failed["[URL_FETCH_FAILED] / [URL_SECURITY_BLOCKED]\nlocalized access-limitation notice"]
    Chat["/api/chat"]
    Generator["Generator\nGoogle Search disabled when URL_CONTENT exists"]

    Prompt --> Stream --> FetchURL --> Direct
    Direct -- "ok + readable body" --> Content
    Direct -- "blocked / short body, non-wikidocs" --> Jina
    Direct -- "blocked / short body, wikidocs" --> Scraper
    Jina -- "ok" --> Content
    Jina -- "failed" --> Failed
    Scraper -- "ok" --> Content
    Scraper -- "failed" --> Failed
    Content --> Chat --> Generator
    Failed --> Chat
```

---

## Pill Image Identification Flow

Image identification fast-path: router → vision extraction → direct DB lookup → exact card / candidate table / failure.

```mermaid
flowchart TB
    Input["User image + identify request"]
    Router["Router fast-path\nimage identification → drug_id"]
    Vision["Vision node\n2.5 Flash extracts imprint/color/shape"]
    State["state.pillData\ninternal only"]
    Lookup["Generator direct DB lookup\nidentifyPillTool.invoke()"]
    Exact{"match_type"}
    Card["json:drug card\nexact only"]
    Table["Markdown candidate table\nimprint_only / similar"]
    Fail["Fixed no-match/error message"]

    Input --> Router --> Vision --> State --> Lookup --> Exact
    Exact -- "exact" --> Card
    Exact -- "imprint_only / similar" --> Table
    Exact -- "none / error" --> Fail
```

---

## Database And Storage Flow

How API routes write to PostgreSQL tables and Storage buckets. See the README for the table/bucket reference.

```mermaid
flowchart TB
    User([User])
    AuthAPI["/api/auth"]
    SessionsAPI["/api/sessions"]
    ChatAPI["/api/chat"]
    UploadAPI["/api/upload\n/api/create-signed-url"]
    SyncAPI["/api/sync-drug-image"]

    subgraph Tables ["PostgreSQL Tables"]
        Users[("users")]
        Sessions[("chat_sessions")]
        Messages[("chat_messages")]
    end

    subgraph Storage ["Storage Buckets"]
        Imgs[("chat-imgs")]
        Videos[("chat-videos")]
        Docs[("chat-docs")]
    end

    User --> AuthAPI --> Users --> Sessions
    User --> SessionsAPI <--> Sessions & Messages
    User --> UploadAPI --> Imgs & Videos & Docs
    User --> ChatAPI --> Messages & Sessions
    SyncAPI --> Imgs & Messages
```
