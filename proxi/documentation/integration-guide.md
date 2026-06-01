# Integration Guide

## API Endpoint

**Base URL**: `http://localhost:5000`

**Main Endpoint**: `POST /api/v1/process`

## Authentication

All requests must include Authorization header:

```
Authorization: Bearer YOUR_GROQ_API_KEY
```

## Request Format

### Headers

```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

### Request Body

```json
{
  "input": "string (required)",
  "context": "string (optional)",
  "max_tokens": "number (optional, default: 1024)",
  "temperature": "number (optional, default: 0.7)",
  "metadata": "object (optional)"
}
```

## Response Format

```json
{
  "output": "string",
  "model_used": "string",
  "tokens_used": {
    "input": "number",
    "output": "number",
    "total": "number"
  },
  "metadata": "object",
  "latency_ms": "number"
}
```

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Authorization header is required"
}
```

### 400 Bad Request
```json
{
  "error": "Input is required"
}
```

### 429 Rate Limit Exceeded
```json
{
  "error": "Rate limit exceeded. Please try again later."
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Model Selection

Backend automatically selects the best model based on input characteristics. No model specification required in request.

## Rate Limits

- RPM: 30 requests per minute
- TPM: 6000 tokens per minute
- RPD: 1000 requests per day
- TPD: 144000 tokens per day

Check current limits: `GET /api/v1/rate-limits`

## Integration Examples

### cURL

```bash
curl -X POST http://localhost:5000/api/v1/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"input": "Your question here"}'
```

### JavaScript (Fetch)

```javascript
fetch('http://localhost:5000/api/v1/process', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    input: 'Your question here'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

### Python (Requests)

```python
import requests

response = requests.post(
    'http://localhost:5000/api/v1/process',
    headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_KEY'
    },
    json={
        'input': 'Your question here'
    }
)

print(response.json())
```

## Notes

- No streaming support
- No tool calling
- No media/audio processing
- Header-based authentication required
- Automatic model routing
