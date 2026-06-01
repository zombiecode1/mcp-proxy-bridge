# API Reference

## Base URL
```
http://localhost:5001
```

Authentication: `Authorization: Bearer <GROQ_API_KEY>`

---

## POST /v1/chat/completions

Fully OpenAI-compatible chat completions. Supports all parameters that Groq supports.

### Request Body
```json
{
  "model": "string (optional, default: auto-select)",
  "messages": [
    {
      "role": "system|user|assistant|tool",
      "content": "string | array"
    }
  ],
  "max_tokens": 1024,
  "temperature": 0.7,
  "top_p": 1,
  "stream": false,
  "stop": "string | array",
  "tools": [...],
  "tool_choice": "auto|none|required|{...}",
  "response_format": {"type": "text|json_object"},
  "seed": null,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "logprobs": false,
  "top_logprobs": null,
  "user": "string",
  "n": 1,
  "parallel_tool_calls": true
}
```

### Response (Non-streaming)
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "llama-3.3-70b-versatile",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello!",
      "tool_calls": null
    },
    "finish_reason": "stop",
    "logprobs": null
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  },
  "system_fingerprint": "fp_xxx"
}
```

### Response (Streaming - SSE)
```
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: [DONE]
```

---

## POST /v1/completions

Legacy text completions (internally mapped to chat).

### Request
```json
{
  "model": "string",
  "prompt": "string",
  "max_tokens": 100,
  "temperature": 0.7,
  "stream": false
}
```

---

## POST /v1/audio/transcriptions

Transcribe audio to text.

### Request (multipart/form-data)
- `file`: Audio file (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm)
- `model`: `whisper-large-v3` or `whisper-large-v3-turbo`
- `language`: ISO-639-1 code (optional)
- `response_format`: `json`, `text`, or `verbose_json`
- `temperature`: 0-1 (optional)

### Response
```json
{"text": "transcribed text"}
```

---

## POST /v1/audio/translations

Translate audio to English.

### Request (multipart/form-data)
- `file`: Audio file
- `model`: `whisper-large-v3` or `whisper-large-v3-turbo`
- `response_format`: `json`, `text`, or `verbose_json`

### Response
```json
{"text": "translated text"}
```

---

## POST /v1/embeddings

Generate embeddings.

### Request
```json
{
  "model": "nomic-embed-text-v1_5",
  "input": "string | string[]",
  "encoding_format": "float | base64"
}
```

### Response
```json
{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.001, ...]
  }],
  "model": "nomic-embed-text-v1_5",
  "usage": {"prompt_tokens": 5, "total_tokens": 5}
}
```

---

## GET /v1/models

List available models.

### Response
```json
{
  "object": "list",
  "data": [
    {"id": "llama-3.3-70b-versatile", "object": "model", "created": 123, "owned_by": "groq"}
  ]
}
```

## GET /v1/models/:id

Get specific model details.

---

## GET /dashboard

HTML dashboard with model list, logs, rate limits, and test tool.

---

## GET /health

Health check.

```json
{"status": "ok", "service": "groq-openai-bridge", "version": "2.0.0"}
```

## Error Format

```json
{
  "error": {
    "message": "Description of the error",
    "type": "error_type",
    "code": "error_code"
  }
}
```

Status codes: 400 (bad request), 401 (auth required), 429 (rate limit), 500 (server error)
