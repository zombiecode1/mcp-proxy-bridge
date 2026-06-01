import fs from 'fs';
import path from 'path';

export interface RuntimeEvent {
  timestamp: string;
  category: string;
  event: string;
  sessionId?: string;
  clientName?: string;
  clientVersion?: string;
  workspaceId?: string;
  directory?: string;
  method?: string;
  status?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const EVENT_LOG_PATH = path.resolve(process.cwd(), 'logs', 'runtime-events.jsonl');
const MAX_EVENTS = 200;

function ensureDir() {
  fs.mkdirSync(path.dirname(EVENT_LOG_PATH), { recursive: true });
}

export function recordRuntimeEvent(event: RuntimeEvent): void {
  try {
    ensureDir();
    fs.appendFileSync(EVENT_LOG_PATH, JSON.stringify(event) + '\n', 'utf8');
  } catch (err) {
    console.warn('runtime event log write failed:', (err as any)?.message || err);
  }
}

export function readRuntimeEvents(limit = MAX_EVENTS): RuntimeEvent[] {
  try {
    if (!fs.existsSync(EVENT_LOG_PATH)) return [];
    const content = fs.readFileSync(EVENT_LOG_PATH, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as RuntimeEvent;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-limit) as RuntimeEvent[];
  } catch {
    return [];
  }
}

export function clearRuntimeEvents(): void {
  try {
    if (fs.existsSync(EVENT_LOG_PATH)) {
      fs.unlinkSync(EVENT_LOG_PATH);
    }
  } catch (err) {
    console.warn('runtime event log clear failed:', (err as any)?.message || err);
  }
}
