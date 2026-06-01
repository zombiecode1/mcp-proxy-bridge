# 🧠 Groq Bridge — Agent + RAG পরিকল্পনা (শয়তানি বুদ্ধি)

> **লেখক:** ZombieCoder ইকোসিস্টেম  
> **উদ্দেশ্য:** শেখা, এবং সীমিত রিসোর্সে সর্বোচ্চ আউটপুট  
> **টার্গেট:** ৫১২MB RAM-এ চলবে, কারও কম্পিউটার খারাপ নয়  
> **মূলনীতি:** RAM-এ রাখব না — ডিস্কে রাখব। Chrome কাঁদবে না।

---

## ⚠️ গুরুত্বপূর্ণ সংশোধন (ভাইয়ার ফিডব্যাক)

**ইন-মেমোরি vector store কাজ করবে না।** কারণ:

1. **Google Chrome** আপনার RAM কখনোই ছেড়ে দেবে না — ব্যাকগ্রাউন্ড প্রসেস, নোটিফিকেশন, GC মিলিয়ে কম্পিউটার কান্না শুরু করবে
2. বড় embedding array মেমোরিতে রাখা = অনিবার্য crash
3. restart-এ সব ডাটা হারিয়ে যাবে

**সঠিক পদ্ধতি:** সবকিছু **ডিস্কে (working directory)** রাখব। মেমোরিতে শুধু session buffer (ছোট, টেম্পোরারি)।

---

## 📋 সূচিপত্র

1. [পুরো আর্কিটেকচার (এক নজরে)](#1-পুরো-আর্কিটেকচার-এক-নজরে)
2. [কী কী লাগবে (dependencies)](#2-কী-কী-লাগবে-dependencies)
3. [RAG সার্ভিস — MD ফাইল থেকে জ্ঞান অন্বেষণ](#3-rag-সার্ভিস--md-ফাইল-থেকে-জ্ঞান-অন্বেষণ)
4. [Agent সার্ভিস — ZombieCoder পার্সোনা + টুল কলিং](#4-agent-সার্ভিস--zombiecoder-পার্সোনা--টুল-কলিং)
5. [মাওলানা রাউটার — ইন্টেন্ট ডিটেকশন + মডেল রাউটিং](#5-মাওলানা-রাউটার--ইন্টেন্ট-ডিটেকশন--মডেল-রাউটিং)
6. [পুরো ফ্লো (স্টেপ বাই স্টেপ)](#6-পুরো-ফ্লো-স্টেপ-বাই-স্টেপ)
7. [কোড স্ট্রাকচার (কোন ফাইলে কী হবে)](#7-কোড-স্ট্রাকচার-কোন-ফাইলে-কী-হবে)
8. [মেমরি এবং পারফরম্যান্স](#8-মেমরি-এবং-পারফরম্যান্স)
9. [FAQ — সম্ভাব্য প্রশ্ন](#9-faq--সম্ভাব্য-প্রশ্ন)

---

## 1. পুরো আর্কিটেকচার (এক নজরে)

**মূলনীতি:** RAM-এ কিছু রাখব না যা ডিস্কে রাখা যায়।  
**Storage Hierarchy:**
- 📀 **ডিস্ক (Working Directory):** Single Source of Truth (MD ফাইল), permission table, project scan output
- 🧠 **মেমোরি (সামান্য):** Agent session buffer (বর্তমান task context + conversation history)

```
ইউজার (POST /v1/chat/completions)
    │
    ▼
┌─────────────────────────────────────┐
│         🔄 Agent Service            │
│                                     │
│  ① ZombieCoder persona বসাও        │
│     (identity.json থেকে)            │
│                                     │
│  ② Working Directory চেক           │
│     ├── SSOT.md আছে?               │
│     │    ├── না → ইউজারকে জিজ্ঞেস   │
│     │    │     → permission নাও    │
│     │    │     → project scan      │
│     │    │     → SSOT.md বানাও     │
│     │    │     → return            │
│     │    │                          │
│     │    └── হ্যাঁ → skip          │
│     │         (ডিস্টার্ব করব না)    │
│     │                              │
│  ③ Intent Detection (ছোট মডেল)    │
│     ├─ "chat" → সরাসরি উত্তর       │
│     ├─ "code" → কোড মোড            │
│     ├─ "rag"   → SSOT.md পড়ে      │
│     └─ "tool"  → টুল এক্সিকিউট     │
│                                     │
│  ④ RAG প্রয়োজন?                    │
│     ├─ না → skip                    │
│     └─ হ্যাঁ → SSOT.md পড়ো         │
│            → grep / section search  │
│            → context-এ inject      │
│                                     │
│  ⑤ Groq Service-এ পাঠাও            │
│     (রেট লিমিট + context check)    │
│                                     │
│  ⑥ রেসপন্স + Flag পার্স           │
│     ├─ type: "chat" → দেখাও        │
│     ├─ type: "code" → execute?     │
│     └─ flag: "tool" → টুল রান      │
│                                     │
│  ⑦ কাজ শেষ → SSOT.md আপডেট করো    │
│     (Agent নিজেই documentation      │
│      লিখবে/আপডেট করবে)             │
│                                     │
│  ⑧ ইউজারকে রেসপন্স                 │
└─────────────────────────────────────┘
```

---

## 2. কী কী লাগবে (dependencies)

আমরা **পুরো LangChain নিচ্ছি না** — শুধু দরকারি দুইটা প্যাকেজ:

```bash
npm install @langchain/core @langchain/textsplitters
```

### কেন এই দুটো?

| প্যাকেজ | কেন দরকার | কতটুকু ব্যবহার করব |
|---------|-----------|-------------------|
| `@langchain/core` | Document interface, Embeddings interface | শুধু base class গুলো |
| `@langchain/textsplitters` | MD ফাইল চাঙ্কিং | MarkdownHeaderSplitter + RecursiveCharacterSplitter |

### যা নিজেরা লিখব (LangChain দরকার নেই):

| নিজেরা লিখব | কারণ |
|------------|------|
| **In-memory Vector Store** | ChromaDB/LanceDB ৩০-৫০MB অতিরিক্ত নেয়। আমাদের নিজের cosine similarity ~৫০ লাইনে হয়ে যায় |
| **Agent Loop** | LangChain Agent ফ্রেমওয়ার্ক অনেক বড় (ReAct, OpenAI Functions, etc)। আমাদের শুধু Groq-এ tool descriptions পাঠানো + response পার্স করা |
| **MD Loader** | `fs.readFileSync` + simple parser — ৩০ লাইন |
| **Embedding Wrapper** | Groq-এর nomic-embed-text-v1_5 — সরাসরি Groq SDK দিয়ে কল, LangChain দিয়ে না |

### মোট নতুন মেমরি ইমপ্যাক্ট: ~১৫-২০MB (নিচের টেবিল দেখুন)

---

## 3. RAG সার্ভিস — না, RAM-এ না। ডিস্ক-based RAG।

### 3.1 কেন ইন-মেমোরি vector store হবে না?

| সমস্যা | প্রভাব |
|--------|--------|
| **Google Chrome memory pressure** | Chrome ব্যাকগ্রাউন্ডে GC রান করাবে, Tab suspend করবে, আপনার অ্যাপের মেমোরি কেড়ে নেবে |
| **Embedding array (৭৬৮-dim)** | ১০০০ chunk = ৭৬৮ × ১০০০ × ৪ bytes = ~৩MB (শুধু embedding)। Chrome এর সাথে এই নিয়ে conflict |
| **Restart = data loss** | প্রতি restart-এ সব embedding ফেরত নিতে হবে — Groq-এর rate limit নষ্ট |
| **৫১২MB target** | মেমোরি বাঁচাতে হবে। শুধু session buffer-এর জন্য রাখব |

### 3.2 সমাধান: ডিস্কে MD = Single Source of Truth

```
Working Directory/
│
├── .zombiecoder/                  (hidden)
│   ├── SSOT.md                    ★ Single Source of Truth
│   ├── permissions.json           ★ User consent table
│   └── session.json               ★ Current session buffer
│
├── src/                           (project code)
├── documentation/
│   └── ...
└── ...
```

### 3.3 ফ্লো: First time vs Subsequent

#### 🆕 First Time (নতুন project):

```
Step 1: ইউজার project directory সিলেক্ট করল
Step 2: Agent → `.zombiecoder/` আছেও?
         → না → ইউজারকে জিজ্ঞেস:
           "আমি আপনার project scan করে documentation বানাবো। অনুমতি দিচ্ছেন?"
Step 3: ইউজার → permission দিল
Step 4: Agent → পুরো directory scan করল:
           ├── file tree
           ├── package.json → dependencies
           ├── src/**/*.ts → exports, classes, functions
           ├── README.md → summary
           └── documentation/**/*.md → existing docs
Step 5: Agent → Groq-এ scan result পাঠাল:
           "এই project টির একটি documentation বানাও"
Step 6: Groq → SSOT.md জেনারেট করল
Step 7: Agent → `.zombiecoder/SSOT.md`-তে save করল
Step 8: ইউজারকে বলল: "আপনার documentation ready!"
```

#### ✅ Subsequent Times (আগে scan করা):

```
Step 1: ইউজার project directory সিলেক্ট করল
Step 2: Agent → `.zombiecoder/SSOT.md` আছেও?
         → হ্যাঁ → ইউজারকে ডিস্টার্ব করবে না
Step 3: সরাসরি কাজ শুরু করল
```

#### 🔄 After Work:

```
Step 1: Agent কাজ শেষ করল
Step 2: Agent → SSOT.md আপডেট করল:
           ├── নতুন ফাইল যোগ করল
           ├── পরিবর্তিত কোড আপডেট করল
           ├── agent notes যোগ করল
           └── version increment
Step 3: ইউজার → সবসময় আপ-টু-ডেট documentation পায়
```

### 3.4 পুরো কোড

**ফাইল:** `src/services/ragService.ts`

```typescript
import fs from 'fs';
import path from 'path';

interface ProjectScanResult {
  tree: string;              // directory tree
  files: {                   // important files
    path: string;
    type: 'source' | 'config' | 'doc' | 'test';
    summary: string;
  }[];
  dependencies: Record<string, string>;
}

interface Permission {
  directory: string;
  grantedAt: number;
  scope: 'scan' | 'write' | 'execute';
}

const ZOMBIE_DIR = '.zombiecoder';
const SSOT_FILE = 'SSOT.md';
const PERM_FILE = 'permissions.json';
const SESSION_FILE = 'session.json';

export class DiskRAGService {
  private workingDir: string = '';
  private ssotPath: string = '';
  private permPath: string = '';
  private sessionBuffer: string[] = [];

  // ─── Working Directory Setup ───────────────────────────
  async setWorkingDirectory(dir: string): Promise<{ needsPermission: boolean }> {
    this.workingDir = dir;
    this.ssotPath = path.join(dir, ZOMBIE_DIR, SSOT_FILE);
    this.permPath = path.join(dir, ZOMBIE_DIR, PERM_FILE);

    // .zombiecoder/ directory exist কিনা
    const zombieDir = path.join(dir, ZOMBIE_DIR);
    if (!fs.existsSync(zombieDir)) {
      return { needsPermission: true };
    }

    // SSOT.md exist কিনা
    if (!fs.existsSync(this.ssotPath)) {
      return { needsPermission: true };
    }

    return { needsPermission: false };
  }

  // ─── Permission ────────────────────────────────────────
  async requestPermission(scope: Permission['scope']): Promise<boolean> {
    console.log(`📋 Agent আপনার project scan করতে চায়।`);
    console.log(`   Directory: ${this.workingDir}`);
    console.log(`   Scope: ${scope}`);
    console.log(`   অনুমতি দিচ্ছেন? (y/n)`);
    // ইউজারকে জিজ্ঞেস — implementation depends on interface
    return true; // will be handled by controller
  }

  grantPermission(scope: Permission['scope']): void {
    const zombieDir = path.join(this.workingDir, ZOMBIE_DIR);
    if (!fs.existsSync(zombieDir)) {
      fs.mkdirSync(zombieDir, { recursive: true });
    }

    const perms: Permission[] = [];
    if (fs.existsSync(this.permPath)) {
      perms.push(...JSON.parse(fs.readFileSync(this.permPath, 'utf-8')));
    }

    perms.push({
      directory: this.workingDir,
      grantedAt: Date.now(),
      scope,
    });

    fs.writeFileSync(this.permPath, JSON.stringify(perms, null, 2));
  }

  hasPermission(scope: Permission['scope']): boolean {
    try {
      if (!fs.existsSync(this.permPath)) return false;
      const perms: Permission[] = JSON.parse(fs.readFileSync(this.permPath, 'utf-8'));
      return perms.some(p => p.directory === this.workingDir && p.scope === scope);
    } catch { return false; }
  }

  // ─── Project Scan ──────────────────────────────────────
  async scanProject(): Promise<ProjectScanResult> {
    const tree = this.buildTree(this.workingDir, 0);
    const files = this.scanFiles(this.workingDir);
    const deps = this.readDependencies();

    return { tree, files, dependencies: deps };
  }

  private buildTree(dir: string, depth: number): string {
    if (depth > 3) return ''; // limit recursion
    let result = '';
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const indent = '  '.repeat(depth);
        result += `${indent}${entry.isDirectory() ? '📁' : '📄'} ${entry.name}\n`;
        if (entry.isDirectory()) {
          result += this.buildTree(path.join(dir, entry.name), depth + 1);
        }
      }
    } catch { /* permission denied */ }
    return result;
  }

  private scanFiles(dir: string): ProjectScanResult['files'] {
    const files: ProjectScanResult['files'] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.scanFiles(fullPath));
        } else {
          const ext = path.extname(entry.name);
          let type: ProjectScanResult['files'][0]['type'] = 'source';
          if (['.json', '.yaml', '.yml', '.toml', '.env.example'].includes(ext)) type = 'config';
          if (['.md', '.txt', '.pdf'].includes(ext)) type = 'doc';
          if (entry.name.startsWith('test') || entry.name.startsWith('spec') || entry.name.endsWith('.test.ts')) type = 'test';

          files.push({
            path: path.relative(this.workingDir, fullPath),
            type,
            summary: '', // Agent ভরাট করবে পরে
          });
        }
      }
    } catch { /* permission denied */ }
    return files;
  }

  private readDependencies(): Record<string, string> {
    try {
      const pkgPath = path.join(this.workingDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return { ...pkg.dependencies, ...pkg.devDependencies };
      }
    } catch { /* no package.json */ }
    return {};
  }

  // ─── SSOT Read/Write ────────────────────────────────────
  async generateSSOT(scanResult: ProjectScanResult): Promise<string> {
    // scan result কে Groq-এ পাঠিয়ে SSOT.md জেনারেট করানো হবে
    // Agent service এই কাজ করবে
    const template = [
      `# ${path.basename(this.workingDir)} — Project Documentation`,
      '',
      '> Auto-generated by ZombieCoder Agent',
      `> Last updated: ${new Date().toISOString()}`,
      '',
      '## Project Structure',
      '```',
      scanResult.tree,
      '```',
      '',
      '## Dependencies',
      Object.entries(scanResult.dependencies)
        .map(([k, v]) => `- \`${k}@${v}\``)
        .join('\n'),
      '',
      '## Source Files',
      scanResult.files
        .filter(f => f.type === 'source')
        .map(f => `- \`${f.path}\``)
        .join('\n'),
      '',
      '## Agent Notes',
      '',
      '_(Agent কাজ করার সাথে সাথে এখানে documentation যোগ করবে)_',
    ].join('\n');

    return template;
  }

  saveSSOT(content: string): void {
    const zombieDir = path.join(this.workingDir, ZOMBIE_DIR);
    if (!fs.existsSync(zombieDir)) {
      fs.mkdirSync(zombieDir, { recursive: true });
    }
    fs.writeFileSync(this.ssotPath, content, 'utf-8');
  }

  readSSOT(): string {
    try {
      return fs.readFileSync(this.ssotPath, 'utf-8');
    } catch { return ''; }
  }

  updateSSOT(newContent: string): void {
    // পুরানো SSOT পড়ো + নতুন তথ্য যোগ করো
    const existing = this.readSSOT();
    const updated = existing + '\n\n---\n\n' + newContent;
    this.saveSSOT(updated);
  }

  ssotExists(): boolean {
    return fs.existsSync(this.ssotPath);
  }

  // ─── Session Buffer (মেমোরিতে, ছোট, টেম্পোরারি) ──────
  addToSession(message: string): void {
    this.sessionBuffer.push(message);
    if (this.sessionBuffer.length > 20) {
      this.sessionBuffer.shift(); // limit to 20 entries
    }
  }

  getSessionContext(): string {
    return this.sessionBuffer.join('\n');
  }

  clearSession(): void {
    this.sessionBuffer = [];
  }

  // ─── Query SSOT (grep-based, no vector search) ──────
  searchSSOT(query: string): string {
    const content = this.readSSOT();
    if (!content) return '';

    const lines = content.split('\n');
    const results: string[] = [];
    const keywords = query.toLowerCase().split(' ').filter(w => w.length > 3);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const matchCount = keywords.filter(k => line.includes(k)).length;
      if (matchCount > 0) {
        // Matching section বের করো (header থেকে পরবর্তী header পর্যন্ত)
        const section = this.getSection(content, lines[i]);
        if (section && !results.includes(section)) {
          results.push(section);
        }
      }
    }

    return results.slice(0, 5).join('\n\n---\n\n');
  }

  private getSection(content: string, matchingLine: string): string {
    const lines = content.split('\n');
    const matchIdx = lines.findIndex(l => l === matchingLine);
    if (matchIdx === -1) return '';

    // পিছনের closest header খুঁজে
    let startIdx = matchIdx;
    for (let i = matchIdx; i >= 0; i--) {
      if (lines[i].startsWith('#')) { startIdx = i; break; }
    }

    // সামনের next header খুঁজে
    let endIdx = lines.length;
    for (let i = matchIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('#')) { endIdx = i; break; }
    }

    return lines.slice(startIdx, endIdx).join('\n').trim();
  }
}
```

### 3.5 RAG এর优缺点 (ডিস্ক-based)

| সুবিধা | অসুবিধা |
|--------|---------|
| ✅ Chrome-এর memory pressure থেকে মুক্ত | Agent কে scan + generate করতে সময় লাগে (প্রথমবার) |
| ✅ Restart-এ ডাটা নিরাপদ | grep-based search embedding-based search-এর চেয়ে কম intelligent |
| ✅ ৫১২MB টার্গেট achievable | বড় project scan করতে permission লাগে |
| ✅ ইউজারের কন্ট্রোল — permission system | - |
| ✅ Agent নিজেই documentation update করে | - |
| ✅ SSOT.md = human-readable, edit করা যায় | - |

---

## 4. Agent সার্ভিস — ZombieCoder পার্সোনা + টুল কলিং

### 4.1 Agent কী?

Agent = Persona + Tools + RAG + Model Router

ZombieCoder persona agent-এর work flow:

```
Agent receives message
  │
  ├── 1. System Prompt বসাও (identity.json থেকে ZombieCoder prompt)
  │
  ├── 2. Tool descriptions সংযুক্ত করো
  │      ○ chat: সাধারণ কথা
  │      ○ code: কোড জেনারেশন/এক্সিকিউশন
  │      ○ rag_search: ডকুমেন্টেশন খোঁজা
  │
  ├── 3. RAG দরকার? → ছোট মডেল দিয়ে classify করো
  │
  ├── 4. Main মডেলে request + context পাঠাও
  │
  └── 5. Response পার্স → Flag অনুযায়ী Action
```

### 4.2 সম্পূর্ণ কোড

**ফাইল:** `src/services/agentService.ts`

```typescript
import { GroqService } from './groqService';
import { RAGService } from './ragService';
import { getIdentity } from './identityService';

interface AgentConfig {
  autoRag: boolean;       // RAG auto-trigger?
  maxRagChunks: number;   // কতগুলো chunk inject করবে?
  defaultModel: string;   // fallback মডেল
}

interface AgentResponse {
  content: string;
  model: string;
  flags: {
    type: 'chat' | 'code' | 'tool' | 'error';
    execute?: boolean;
    language?: string;
    safety?: 'safe' | 'unsafe' | 'unknown';
  };
  ragUsed?: boolean;
  toolResults?: any[];
}

const DEFAULT_CONFIG: AgentConfig = {
  autoRag: true,
  maxRagChunks: 5,
  defaultModel: 'llama-3.3-70b-versatile',
};

export class AgentService {
  private config: AgentConfig;
  private identityCache: { name: string; prompt: string } | null = null;

  constructor(
    private groq: GroqService,
    private rag?: RAGService,
    config?: Partial<AgentConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadIdentity();
  }

  // ─── Persona Load ────────────────────────────────────────
  private loadIdentity(): void {
    try {
      const identity = getIdentity();
      if (identity?.system_identity) {
        this.identityCache = {
          name: identity.system_identity.name || 'ZombieCoder',
          prompt: identity.system_identity.system_prompt || '',
        };
      }
    } catch {
      this.identityCache = null;
    }
  }

  getPersonaName(): string {
    return this.identityCache?.name || 'ZombieCoder';
  }

  // ─── Intent Detection (ছোট মডেল দিয়ে) ──────────────────
  private async detectIntent(
    messages: { role: string; content: string }[],
  ): Promise<{ needsRag: boolean; category: string }> {
    // খুব ছোট মেসেজ → RAG দরকার নেই
    const lastMsg = messages[messages.length - 1]?.content || '';
    if (lastMsg.length < 20) return { needsRag: false, category: 'chat' };

    // RAG-এর জন্য keyword check (দ্রুত, মডেল না ডেকে)
    const ragKeywords = [
      'ডকুমেন্টেশন', 'documentation', 'কিভাবে', 'how to', 'বুঝি', 
      'কী', 'what is', 'ব্যাখ্যা', 'explain', 'guide', 'টিউটোরিয়াল',
      'doc', 'manual', 'README',
    ];
    const hasRagIntent = ragKeywords.some(k => lastMsg.toLowerCase().includes(k.toLowerCase()));

    if (hasRagIntent && this.rag?.isReady()) {
      return { needsRag: true, category: 'rag' };
    }

    // কোড চেক
    const codeKeywords = ['code', 'কোড', 'function', 'ফাংশন', 'script', 'program'];
    const isCode = codeKeywords.some(k => lastMsg.toLowerCase().includes(k.toLowerCase()));

    return {
      needsRag: false,
      category: isCode ? 'code' : 'chat',
    };
  }

  // ─── Tool descriptions ──────────────────────────────────
  private getToolDescriptions(): string {
    return [
      '--- Available Tools ---',
      '1. chat: সাধারণ প্রশ্নের উত্তর দাও',
      '2. code_generation: কোড লিখে দাও (Python, JS, TS, etc.)',
      '3. rag_search: ডকুমেন্টেশন খুঁজে তথ্য দাও',
      '',
      'Response format (JSON):',
      '{',
      '  "content": "তোমার উত্তর",',
      '  "flags": {',
      '    "type": "chat" | "code" | "tool",',
      '    "execute": true/false,',
      '    "language": "python" | "javascript" | etc.',
      '  }',
      '}',
    ].join('\n');
  }

  // ─── Main Agent Execution ───────────────────────────────
  async processMessage(
    userMessages: { role: string; content: string }[],
    preferredModel?: string,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    // ① Intent Detection
    const intent = await this.detectIntent(userMessages);
    let ragContext = '';

    // ② RAG (যদি দরকার হয়)
    if (intent.needsRag && this.rag?.isReady()) {
      const lastMsg = userMessages[userMessages.length - 1]?.content || '';
      ragContext = await this.rag.query(lastMsg, this.config.maxRagChunks);
    }

    // ③ Persona + Tools + RAG Context → System Message
    const systemParts: string[] = [];

    if (this.identityCache?.prompt) {
      systemParts.push(this.identityCache.prompt);
    }

    systemParts.push(this.getToolDescriptions());

    if (ragContext) {
      systemParts.push(
        '--- Documentation Context (RAG) ---',
        'নিচের ডকুমেন্টেশন থেকে তথ্য নিয়ে উত্তর দাও:',
        ragContext,
        '--- End of RAG Context ---',
      );
    }

    const systemMessage = systemParts.join('\n\n');

    // ④ Groq-এ পাঠানোর জন্য messages তৈরি
    const groqMessages = [
      { role: 'system', content: systemMessage },
      ...userMessages,
    ];

    // ⑤ Model নির্ধারণ
    const categoryToModel: Record<string, string> = {
      chat: 'llama-3.3-70b-versatile',
      code: 'mixtral-8x7b-32768',
      rag: 'llama-3.3-70b-versatile',
    };

    const model = preferredModel || categoryToModel[intent.category] || this.config.defaultModel;

    // ⑥ Groq-এ পাঠাও
    try {
      const completion = await this.groq.createChatCompletion({
        model,
        messages: groqMessages as any,
        max_tokens: 4096,
        temperature: 0.7,
        stream: false,
      });

      const rawContent = (completion as any).choices?.[0]?.message?.content || '';

      // ⑦ Response থেকে JSON flag পার্স
      const { content, flags } = this.parseResponse(rawContent);

      return {
        content,
        model,
        flags,
        ragUsed: intent.needsRag && !!ragContext,
      };

    } catch (err: any) {
      // Fallback: error হলে simpler model দিয়ে try
      if (model !== this.config.defaultModel) {
        console.warn(`⚠️ Agent: ${model} failed, falling back to ${this.config.defaultModel}`);

        const fallbackMsgs = [
          { role: 'system', content: this.identityCache?.prompt || 'You are a helpful assistant.' },
          ...userMessages,
        ];

        const fallback = await this.groq.createChatCompletion({
          model: this.config.defaultModel,
          messages: fallbackMsgs as any,
          max_tokens: 2048,
          temperature: 0.7,
          stream: false,
        });

        const fbContent = (fallback as any).choices?.[0]?.message?.content || '';

        return {
          content: fbContent,
          model: this.config.defaultModel,
          flags: { type: 'chat', safety: 'unknown' },
          ragUsed: false,
        };
      }

      throw err;
    }
  }

  // ─── Flag Parser ────────────────────────────────────────
  private parseResponse(raw: string): { content: string; flags: AgentResponse['flags'] } {
    // Try JSON format: { "content": "...", "flags": {...} }
    try {
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.content && parsed.flags) {
          return {
            content: parsed.content,
            flags: {
              type: parsed.flags.type || 'chat',
              execute: parsed.flags.execute || false,
              language: parsed.flags.language,
              safety: parsed.flags.safety || 'safe',
            },
          };
        }
      }
    } catch {
      // JSON না হলে, content হিসেবে পুরো response
    }

    // Default: plain text response
    return {
      content: raw,
      flags: { type: 'chat', safety: 'safe' },
    };
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
```

---

## 5. মাওলানা রাউটার — ইন্টেন্ট ডিটেকশন + মডেল রাউটিং

### 5.1 মাওলানা আসলে কী?

মাওলানা = **একটি ছোট, ফ্রি মডেল** (যেমন `llama3-8b-8192`) যা ইউজারের মেসেজ পড়ে বুঝবে:

1. **ইনপুট টাইপ কী?** — chat / code / rag / vision?
2. **কোন মডেলে পাঠানো উচিত?**
3. **RAG দরকার?**

তারপর সেই অনুযায়ী appropriate মডেলে রুট করবে।

### 5.2 কোড

**ফাইল:** `src/services/mawlanaRouter.ts`

```typescript
import { GroqService } from './groqService';

interface RouteDecision {
  model: string;
  category: string;
  needsRag: boolean;
  confidence: number;
}

export class MawlanaRouter {
  constructor(private groq: GroqService) {}

  async route(
    messages: { role: string; content: string }[],
    preferredCategory?: string,
  ): Promise<RouteDecision> {
    // যদি ইউজার category বলে দেয়, সেটাই use করো
    if (preferredCategory) {
      return this.categoryToRoute(preferredCategory);
    }

    // ছোট মেসেজ → সরাসরি chat
    const lastMsg = messages[messages.length - 1]?.content || '';
    if (lastMsg.length < 15) {
      return {
        model: 'llama-3.3-70b-versatile',
        category: 'chat',
        needsRag: false,
        confidence: 0.9,
      };
    }

    // ছোট মডেল দিয়ে classify করো
    try {
      const classification = await this.classifyWithSmallModel(lastMsg);
      return classification;
    } catch {
      // Fallback
      return this.categoryToRoute('chat');
    }
  }

  private async classifyWithSmallModel(input: string): Promise<RouteDecision> {
    const classifyPrompt = [
      { role: 'system', content: [
        'তুমি একটি রাউটার। ইউজারের মেসেজ পড়ে বলো এটি কোন ক্যাটাগরির।',
        'শুধু JSON উত্তর দাও:',
        '{ "category": "chat" | "code" | "rag" | "vision" }',
      ].join('\n')},
      { role: 'user', content: input },
    ];

    const response = await this.groq.createChatCompletion({
      model: 'llama3-8b-8192', // ছোট, ফ্রি মডেল
      messages: classifyPrompt as any,
      max_tokens: 50,
      temperature: 0,
      stream: false,
    });

    const text = (response as any).choices?.[0]?.message?.content || '';
    const match = text.match(/"category"\s*:\s*"(chat|code|rag|vision)"/);
    const category = match?.[1] || 'chat';

    return this.categoryToRoute(category);
  }

  private categoryToRoute(category: string): RouteDecision {
    const routes: Record<string, RouteDecision> = {
      chat:    { model: 'llama-3.3-70b-versatile', category: 'chat',    needsRag: false, confidence: 0.8 },
      code:    { model: 'mixtral-8x7b-32768',      category: 'code',    needsRag: false, confidence: 0.8 },
      rag:     { model: 'llama-3.3-70b-versatile', category: 'rag',     needsRag: true,  confidence: 0.7 },
      vision:  { model: 'llama-3.2-11b-vision-preview', category: 'vision', needsRag: false, confidence: 0.8 },
    };

    return routes[category] || routes.chat;
  }
}
```

---

## 6. পুরো ফ্লো (স্টেপ বাই স্টেপ)

একটি উদাহরণ দিয়ে বুঝি:

### Scenario: ইউজার বলল "Groq Bridge-এর RAG কিভাবে কাজ করে?"

```
Step 1: ইউজার → AgentService.processMessage()
Step 2: Agent → detectIntent() → ছোট মডেল দিয়ে classify করে
         → "rag" category → needsRag = true
Step 3: Agent → rag.query("Groq Bridge-এর RAG কিভাবে কাজ করে?")
         → nomic-embed-text-v1_5 দিয়ে query embed
         → cosine similarity → top 5 chunks
Step 4: Agent → system message তৈরি:
         [ZombieCoder persona]
         [Tool descriptions]
         [RAG Context: ...চাঙ্ক ১... ...চাঙ্ক ২...]
Step 5: Groq Service → rate limit চেক → context window চেক
Step 6: Groq API → llama-3.3-70b-versatile → response
Step 7: Agent → parseResponse()
         → JSON flag বের করে
         → { type: "chat", content: "RAG是这样工作的..." }
Step 8: ইউজারকে রেসপন্স
```

---

## 7. কোড স্ট্রাকচার (কোন ফাইলে কী হবে)

```
src/
├── index.ts                    (entry point: RAG + Agent initialize)
├── types/
│   └── index.ts                (AgentResponse, RouteDecision types)
├── services/
│   ├── groqService.ts          (existing: model routing + rate limits)
│   ├── identityService.ts      (existing: ZombieCoder persona)
│   ├── fileLogger.ts           (existing)
│   ├── ragService.ts           ★ NEW: RAG pipeline
│   ├── agentService.ts         ★ NEW: Agent + Persona + Tool calling
│   └── mawlanaRouter.ts        ★ NEW: Intent classification + routing
├── controllers/
│   ├── openaiController.ts     (existing: /v1/chat/completions handler)
│   └── agentController.ts      ★ NEW: agent-specific endpoint
└── routes/
    └── index.ts                (existing: add agent route)
```

### পরিবর্তনের সারসংক্ষেপ:

| ফাইল | কি পরিবর্তন হবে |
|------|----------------|
| `src/index.ts` | RAGService + AgentService initialize করবে startup-এ |
| `src/services/groqService.ts` | - (না change, already has createEmbeddings) |
| `src/services/ragService.ts` | **নতুন** — পুরো RAG pipeline |
| `src/services/agentService.ts` | **নতুন** — Agent with persona |
| `src/services/mawlanaRouter.ts` | **নতুন** — ছোট মডেল দিয়ে intent classification |
| `src/controllers/agentController.ts` | **নতুন** — Agent endpoint handler |
| `src/routes/index.ts` | নতুন route: `POST /v1/agent/chat` |

---

## 8. মেমরি এবং পারফরম্যান্স

### 8.1 মেমরি ব্রেকডাউন (৫১২MB টার্গেট) — সংশোধিত

**মূল পরিবর্তন:** ইন-মেমোরি vector store সরানো হয়েছে → ডিস্ক-based SSOT.md  

| কম্পোনেন্ট | মেমরি (approx) | কোথায়? |
|-----------|----------------|---------|
| Node.js runtime | 40 MB | RAM |
| Express.js | 15 MB | RAM |
| Groq SDK | 10 MB | RAM |
| **RAG: SSOT.md** | **~0 MB** | 📀 **ডিস্কে** (শুধু পড়ার সময় buffer) |
| **RAG: vector store** | **~0 MB** | ❌ **বাদ দেওয়া হয়েছে** |
| langchain/core + textsplitters | ~15 MB | RAM |
| Agent session buffer | ~2 MB | RAM (ছোট, max ২০ entry) |
| Permission table | ~0.1 MB | RAM + 📀 ডিস্কে backup |
| Logs, rate limits, misc | ~10 MB | RAM |
| **Total** | **~92 MB** | |
| **৫১২MB টার্গেটের %** | **~১৮%** | |

→ ৫১২MB-এ আরামে চলবে। পুরানো in-memory version (~১০৫MB) থেকে **১৩MB কম**।

### 8.2 Performance Optimization Tips

| Optimization | কিভাবে |
|-------------|--------|
| **Lazy RAG init** | Startup-এ সব embed না করে, first RAG query-তে লোড |
| **Chunk cache** | Embedding result JSON ফাইলে cache করে রাখো, restart-এ reload |
| **Small model first** | বড় মডেলে পাঠানোর আগে ছোট মডেল দিয়ে প্রি-প্রসেস |
| **Batch embedding** | Groq-এর batch embedding support করে — ২০টা একসাথে |
| **Stream output** | Agent response stream করলে UI faster লাগে |
| **GC friendly** | বড় array (embeddings) না রাখা — Float32Array use করা |

---

## 9. FAQ — সম্ভাব্য প্রশ্ন

### Q1: LangChain না নিয়ে সরাসরি Groq SDK দিয়েই তো RAG করা যায়?
**উত্তর:** হ্যাঁ, যায়। LangChain শুধু `Document` interface আর `textsplitters`-এর জন্য নেওয়া — এগুলো MD চাঙ্কিংয়ে অনেক সুবিধা দেয়। Agent আর Vector Store আমরা নিজেরা লিখছি, LangChain এর জন্য না।

### Q2: vector store না থাকলে RAG কিভাবে কাজ করবে?
**উত্তর:** embedding-based vector search লাগবে না। SSOT.md = পুরো documentation একটি ফাইলে। Agent grep/section search দিয়ে relevant অংশ খুঁজে বের করবে। ছোট project-এর জন্য এটি যথেষ্ট। বড় project হলে Agent SSOT.md-কে section আকারে organize করবে।

### Q3: SSOT.md খুব বড় হয়ে গেলে সমস্যা হবে না?
**উত্তর:** হবে, কিন্তু সমাধান আছে:
- পুরানো section archive করে `.zombiecoder/archive/`-এ রাখা যাবে
- Agent শুধু latest version রাখবে
- Token limit manage করতে Agent নিজেই summarize করে ছোট করবে

### Q4: Permission system কেন লাগবে?
**উত্তর:** ইউজারের রাজি ছাড়া Agent project scan করতে পারবে না। permission.json-এ record থাকে। ইউজার চাইলে যে কোন সময় permission revoke করতে পারবে। এটি trust বাড়ায়।

### Q5: ৫১২MB-এ সবকিছু চলবে?
**উত্তর:** হ্যাঁ, উপরের টেবিল অনুযায়ী মোট ~৯২MB। বাকি ~৪২০MB ফ্রি থাকবে OS, Chrome, আর অন্যান্য কাজের জন্য।

### Q6: SSOT.md কে আপডেট করবে?
**উত্তর:** Agent নিজেই। কাজ শুরু করার আগে SSOT.md পড়ে context নেয়। কাজ শেষে পরিবর্তনগুলো SSOT.md-এ যোগ করে। ইউজার চাইলে নিজেও edit করতে পারে — এটাই MD format-এর সুবিধা।

---

## 🎯 শেষ কথা

এই পুরো প্ল্যানটি আপনার "শয়তানি বুদ্ধি"-র উপর ভিত্তি করে:

1. **মাওলানা রাউটার** → ছোট মডেল দিয়ে intent detect + appropriate model-এ route
2. **ZombieCoder Agent** → identity.json থেকে persona + tool descriptions
3. **RAG from MD** → documentation = single source of truth
4. **Flag-based execution** → মডেল বলে কী করতে হবে, প্রসেসর করে
5. **৫১২MB target** → কারও কম্পিউটার খারাপ নয়

বিদ্যুৎ চলে গেলেও, এই ফাইলটি পড়লেই সব মনে হবে। 💪

---

> "যেখানে কোড ও কথা বলে" — ZombieCoder  
> ডকুমেন্টেশন আপডেট: মে ২০২৬
