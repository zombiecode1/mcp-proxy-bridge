# Groq OpenAI-Compatible Bridge

A lightweight, OpenAI-compatible API proxy built on top of Groq's SDK. This bridge lets any OpenAI-compatible client (LangChain, LlamaIndex, cURL, OpenAI SDK, etc.) target Groq models using the standard OpenAI request format—no vendor lock-in required.

## Key Features

- **OpenAI-compatible endpoints**: `POST /v1/chat/completions`, `POST /v1/embeddings`, `POST /v1/audio/transcriptions`, `GET /v1/models`, and other OpenAI-style routes.
- **Smart auto-routing**: If `model` is omitted or set to `auto`, the bridge selects an appropriate Groq model based on input size and available models.
- **Feature pass-through**: Tool calling, vision/image inputs, JSON response modes, streaming responses, and logprobs are proxied when supported by the backend.
- **Real-time dashboard**: Visit `http://localhost:5001/dashboard` to view model lists, rate limits, and request logs.
- **Per-model rate limits**: RPM/TPM tracking per model.
- **OpenAI-style authentication**: Uses `Authorization: Bearer <GROQ_API_KEY>`.

## Architecture

```
groq-openai-bridge/
├── src/
│   ├── index.ts                  # Express server entry
│   ├── types/index.ts            # Type definitions
│   ├── services/groqService.ts   # Groq SDK integration, routing, rate limits
│   ├── controllers/openaiController.ts  # OpenAI-compatible request handlers
│   ├── routes/index.ts           # Endpoint routing and dashboard
│   ├── middleware/
│   │   ├── authMiddleware.ts     # Bearer token authentication
│   │   └── loggingMiddleware.ts  # Request/response logging
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

## Installation & Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Create and edit your .env
cp .env.example .env
# Set GROQ_API_KEY in .env

# 3. Start (development)
npm run dev

# Or build and run for production
npm run build 
 npm start
```

## OpenAI-Compatible API

The bridge exposes familiar OpenAI-style endpoints. Examples below use `http://localhost:5001` and the `GROQ_API_KEY` from your `.env`.

### Chat Completions (full feature example)

```bash
curl http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100,
    "temperature": 0.7
  }'
```

All standard OpenAI parameters are supported where the backend model supports them: `model`, `messages`, `max_tokens`, `temperature`, `top_p`, `stop`, `stream`, `tools`, `tool_choice`, `response_format`, `seed`, `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs`, `n`, `user`, `parallel_tool_calls`.

### Streaming

```bash
curl -N http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Tool/Function Calling

```bash
curl http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": { "location": {"type":"string"} }
        }
      }
    }]
  }'
```

### Image / Vision Inputs

```bash
curl http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.2-90b-vision-preview",
    "messages": [
      {"role":"user","content":[
        {"type":"text","text":"What is in this image?"},
        {"type":"image_url","image_url":{"url":"https://example.com/image.jpg"}}
      ]}
    ]
  }'
```

### Audio Transcription

```bash
curl http://localhost:5001/v1/audio/transcriptions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@audio.mp3" \
  -F "model=whisper-large-v3"
```

### Embeddings

```bash
curl http://localhost:5001/v1/embeddings \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "model": "nomic-embed-text-v1_5", "input": "The quick brown fox" }'
```

## Dashboard

Open `http://localhost:5001/dashboard` to view:

- Model list and metadata
- Per-model rate limits and current usage
- Real-time request logs and quick test tools
- Uptime and memory stats

## Smart Model Routing

If `model` is omitted or set to `auto`, the bridge uses a heuristic based on input size:

| Input size | Model class |
|---|---|
| Small | Fast / lower-cost models
| Medium | Balanced models
| Large | High-capacity models

Pass a specific `model` to bypass routing.

## Authentication

Use an OpenAI-style bearer token header:

```
Authorization: Bearer <your_groq_api_key>
```

The service reads `GROQ_API_KEY` from `.env`.

## Example client usage

### Python (OpenAI SDK)

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:5001/v1", api_key="gsk_...")
response = client.chat.completions.create(model="auto", messages=[{"role":"user","content":"Hello!"}])
```

### JavaScript (OpenAI SDK)

```javascript
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://localhost:5001/v1', apiKey: 'gsk_...' });
```

### LangChain

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(base_url="http://localhost:5001/v1", api_key="gsk_...", model="auto")
```

## Configuration

Edit `.env` to set the service port and API key:

```env
PORT=5001
GROQ_API_KEY=gsk_...
```

## License

MIT
# Groq OpenAI-Compatible Bridge

A lightweight, OpenAI-compatible API proxy built on top of Groq's SDK. This bridge lets any OpenAI-compatible client (LangChain, LlamaIndex, cURL, OpenAI SDK, etc.) target Groq models using the standard OpenAI request format—no vendor lock-in required.

## Key Features

- **OpenAI-compatible endpoints**: `POST /v1/chat/completions`, `POST /v1/embeddings`, `POST /v1/audio/transcriptions`, `GET /v1/models`, and other OpenAI-style routes.
- **Smart auto-routing**: If `model` is omitted or set to `auto`, the bridge selects an appropriate Groq model based on input size and available models.
- **Feature pass-through**: Tool calling, vision/image inputs, JSON response modes, streaming responses, and logprobs are proxied when supported by the backend.
- **Real-time dashboard**: Visit `http://localhost:5001/dashboard` to view model lists, rate limits, and request logs.
- **Per-model rate limits**: RPM/TPM tracking per model.
- **OpenAI-style authentication**: Uses `Authorization: Bearer <GROQ_API_KEY>`.

## Architecture

```
groq-openai-bridge/
├── src/
│   ├── index.ts                  # Express server entry
│   ├── types/index.ts            # Type definitions
│   ├── services/groqService.ts   # Groq SDK integration, routing, rate limits
│   ├── controllers/openaiController.ts  # OpenAI-compatible request handlers
│   ├── routes/index.ts           # Endpoint routing and dashboard
│   ├── middleware/
│   │   ├── authMiddleware.ts     # Bearer token authentication
│   │   └── loggingMiddleware.ts  # Request/response logging
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

## Installation & Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Create and edit your .env
cp .env.example .env
# Set GROQ_API_KEY in .env

# 3. Start (development)
npm run dev

# Or build and run for production
npm run build && npm start
```

## OpenAI-Compatible API

The bridge exposes familiar OpenAI-style endpoints. Examples below use `http://localhost:5001` and the `GROQ_API_KEY` from your `.env`.

### Chat Completions (full feature example)

```bash
curl http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100,
    "temperature": 0.7
  }'
```

All standard OpenAI parameters are supported where the backend model supports them: `model`, `messages`, `max_tokens`, `temperature`, `top_p`, `stop`, `stream`, `tools`, `tool_choice`, `response_format`, `seed`, `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs`, `n`, `user`, `parallel_tool_calls`.

### Streaming

```bash
curl -N http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Tool/Function Calling

```bash
curl http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": { "location": {"type":"string"} }
        }
      }
    }]
  }'
```

### Image / Vision Inputs

```bash
curl http://localhost:5001/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.2-90b-vision-preview",
    "messages": [
      {"role":"user","content":[
        {"type":"text","text":"What is in this image?"},
        {"type":"image_url","image_url":{"url":"https://example.com/image.jpg"}}
      ]}
    ]
  }'
```

### Audio Transcription

```bash
curl http://localhost:5001/v1/audio/transcriptions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@audio.mp3" \
  -F "model=whisper-large-v3"
```

### Embeddings

```bash
curl http://localhost:5001/v1/embeddings \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "model": "nomic-embed-text-v1_5", "input": "The quick brown fox" }'
```

## Dashboard

Open `http://localhost:5001/dashboard` to view:

- Model list and metadata
- Per-model rate limits and current usage
- Real-time request logs and quick test tools
- Uptime and memory stats

## Smart Model Routing

If `model` is omitted or set to `auto`, the bridge uses a heuristic based on input size:

| Input size | Model class |
|---|---|
| Small | Fast / lower-cost models
| Medium | Balanced models
| Large | High-capacity models

Pass a specific `model` to bypass routing.

## Authentication

Use an OpenAI-style bearer token header:

```
Authorization: Bearer <your_groq_api_key>
```

The service reads `GROQ_API_KEY` from `.env`.

## Example client usage

### Python (OpenAI SDK)

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:5001/v1", api_key="gsk_...")
response = client.chat.completions.create(model="auto", messages=[{"role":"user","content":"Hello!"}])
```

### JavaScript (OpenAI SDK)

```javascript
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://localhost:5001/v1', apiKey: 'gsk_...' });
```

### LangChain

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(base_url="http://localhost:5001/v1", api_key="gsk_...", model="auto")
```

## Configuration

Edit `.env` to set the service port and API key:

```env
PORT=5001
GROQ_API_KEY=gsk_...
```

## License

MIT
