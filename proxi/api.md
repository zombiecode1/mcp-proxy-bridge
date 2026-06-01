Here's a complete solution for your OpenAI-compatible API proxy using Groq's SDK in TypeScript with an organized directory structure:

openai-groq-proxy/
├── .env
├── tsconfig.json
├── package.json
├── src/
│   ├── index.ts
│   ├── config/
│   │   └── modelMapping.ts
│   ├── controllers/
│   │   └── openAIController.ts
│   ├── middleware/
│   │   ├── authMiddleware.ts
│   │   └── errorMiddleware.ts
│   ├── models/
│   │   └── requestModels.ts
│   ├── routes/
│   │   └── openAIRoute.ts
│   └── services/
│       └── groqService.ts
└──
1. Environment File (.env)

PORT=5000
GROQ_API_KEY=your_groq_api_key
2. Type Definitions (src/models/requestModels.ts)

export interface OpenAIRequest {
  model: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}
3. Model Mapping Configuration (src/config/modelMapping.ts)

export const MODEL_MAP: Record<string, string> = {
  'gpt-3.5-turbo': 'llama3-70b',
  'gpt-3.5-turbo-16k': 'llama3-70b',
  'text-davinci-003': 'llama3-70b',
  'text-curie-001': 'llama3-70b',
};
4. Groq Service (src/services/groqService.ts)

import { generate } from 'groq-sdk';
import { MODEL_MAP } from '../config/modelMapping';

export async function streamCompletion(openAIRequest: OpenAIRequest) {
  const groqModel = MODEL_MAP[openAIRequest.model] || 'llama3-70b';
  
  const response = await generate(groqModel, {
    prompt: openAIRequest.prompt || extractContent(openAIRequest.messages),
    max_tokens: openAIRequest.max_tokens || 512
  });

  return formatResponse(response);
}

function extractContent(messages: Array<{ role: string; content: string }> | undefined) {
  return messages?.map(m => m.content).join('\n') || '';
}
5. OpenAI Controller (src/controllers/openAIController.ts)

import express from 'express';
import { streamCompletion } from '../services/groqService';
import { OpenAIRequest } from '../models/requestModels';

export const completions = async (req: express.Request, res: express.Response) => {
  try {
    const openAIRequest = req.body as OpenAIRequest;
    const stream = await streamCompletion(openAIRequest);
    
    res.setHeader('Content-Type', 'application/json');
    for await (const chunk of stream) {
      res.write(JSON.stringify(chunk));
    }
    res.end();
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
6. OpenAI Route Configuration (src/routes/openAIRoute.ts)

import express from 'express';
import { completions } from '../controllers/openAIController';

const router = express.Router();

// Text Completion
router.post('/v1/completions', completions);

// Chat Completion
router.post('/v1/chat/completions', completions);

export default router;
7. Error Handling Middleware (src/middleware/errorMiddleware.ts)

export const handleErrors = (error: Error, req: any, res: any, next: any) => {
  if (res.headersSent) {
    return next(error);
  }
  console.error(error);
  res.status(500).json({
    error: { message: error.message }
  });
};
8. Authentication Middleware (src/middleware/authMiddleware.ts)

export const authenticate = (req: any, res: any, next: any) => {
  // OpenAI auth format (using GROQ_API_KEY from .env)
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return res.status(500).json({ error: 'No Groq API key provided' });
  }
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'No authorization provided' });
  }
  next();
};
9. Server Entry Point (src/index.ts)

import express from 'express';
import dotenv from 'dotenv';
import openAIRoute from './routes/openAIRoute';
import { authenticate } from './middleware/authMiddleware';
import { handleErrors } from './middleware/errorMiddleware';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use('/api', authenticate, openAIRoute);
app.use(handleErrors);

app.listen(PORT, () => {
  console.log(`OpenAI-Groq Proxy running on http://localhost:${PORT}`);
  console.log(`Using model mapping: ${Object.keys(MODEL_MAP).join(', ')}`);
});
10. Configuration File (tsconfig.json)

{
  "compilerOptions": {
    "target": "ES6",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
11. Package.json Scripts

"scripts": {
  "start": "node dist/index.js",
  "build": "tsc",
  "dev": "nodemon --watch 'src/**/*.ts' --exec ts-node src/index.ts"
}
Usage Example:

# With cURL
curl -X POST http://localhost:5000/api/v1/completions \
  -H "Authorization: B
Continue

Thought for 5s
Here's the continuation and completion of the project setup along with example usage:

12. Complete cURL Example (Continued)

# With cURL
curl -X POST http://localhost:5000/api/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer DUMMY_API_KEY" \
  -d '{
    "model": "text-davinci-003",
    "prompt": "Explain quantum computing in simple terms.",
    "max_tokens": 50
  }'
13. Chat Completion Example with cURL

curl -X POST http://localhost:5000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer DUMMY_API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "What is the capital of France?"},
      {"role": "assistant", "content": "Paris"}
    ]
  }'
14. Enhanced Groq Service with OpenAI Compatibility (src/services/groqService.ts)

import { generate } from 'groq-sdk';
import { MODEL_MAP, MODEL_MAP as modelMap } from '../config/modelMapping';
import { OpenAIRequest } from '../models/requestModels';

export async function streamCompletion(openAIRequest: OpenAIRequest) {
  const groqModel = modelMap[openAIRequest.model || ''] as string || 'llama3-70b
Continue

Thought for 2s
Here's the completed and enhanced implementation for the project:

14. Continued Groq Service (src/services/groqService.ts)

import { generate } from 'groq-sdk';
import { MODEL_MAP as modelMap } from '../config/modelMapping';
import { OpenAIRequest } from '../models/requestModels';

export async function streamCompletion(openAIRequest: OpenAIRequest) {
  const groqModel = modelMap[openAIRequest.model || ''] as string || 'llama3-70b';
  
  // Extract content from either prompt or messages
  const content = openAIRequest.prompt || 
                 (openAIRequest.messages?.map(m => m.content).join('\n') || '');
  
  // Format request parameters compatible with both API versions
  const params = {
    model: groqModel,
    prompt: content,
    temperature: openAIRequest.temperature || 1.0,
    max_tokens: openAIRequest.max_tokens || 512
  };

  // Handle model mapping errors
  if (!modelMap[openAIRequest.model]) {
    throw new Error(`Model ${openAIRequest.model} not supported`);
  }

  return generate(params).on('content', chunk => {
    // Stream Groq response as OpenAI compatible format
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: groqModel,
      choices: [{
        index: 0,
        text: chunk,
        finish_reason: chunk ? null : 'stop'
      }],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 50,
        total_tokens: 100
      }
    };
  });
}
15. Format Response as OpenAI Standard (src/services/groqService.ts)

function formatResponse(groqResponse: any): any {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: openAIRequest.messages ? 'chat.completion' : 'text.completion',
    created: Math.floor(Date.now() / 1000),
    model: groqResponse.model,
    choices: groqResponse.choices.map((choice: any) => ({
      index: choice.index,
      text: choice.text,
      finish_reason: choice.finish_reason
    })),
    usage: {
      prompt_tokens: groqResponse.usage.prompt_tokens,
      completion_tokens: groqResponse.usage.completion_tokens,
      total_tokens: groqResponse.usage.total_tokens
    }
  };
}
16. Enhanced Controller with Stream Handling (src/controllers/openAIController.ts)

import express from 'express';
import { Stream } from 'stream';
import { streamCompletion } from '../services/groqService';
import { OpenAIRequest } from '../models/requestModels';

export const completions = async (req: express.Request, res: express.Response) => {
  try {
    const openAIRequest = req.body as OpenAIRequest;
    
    if ('messages' in openAIRequest) {
      // Chat completion logic
      const stream = await streamCompletion(openAIRequest);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked'
      });

      stream.on('data', (chunk: any) => {
        res.write(JSON.stringify(chunk) + '\n');
      });

      stream.on('end', () => {
        res.end();
      });
    } else {
      // Text completion logic
      const response = await streamCompletion(openAIRequest);
      res.json(formatResponse(response));
    }
  } catch (error) {
    res.status(500).json({ 
      error: {
        message: error.message,
        type: "server_error"
      }
    });
  }
};
17. Model Mapping Enhancements (src/config/modelMapping.ts)

export const MODEL_MAP: Record<string, string> = {
  // Chat models
  'gpt-3.5-turbo': 'llama3-70b',
  'gpt-3.5-turbo-16k': 'llama3-70b',
  'gpt-4': 'llama3-70b', // Temporary mapping
  'gpt-4-32k': 'llama3-70b',
  
  // Text generation models
  'text-davinci-003': 'llama3-70b',
  'text-curie-001': 'llama3-70b',
  'babbage-002': 'llama3-70b'
};
18. Add Token Counting Logic (src/utils/tokenCounter.ts)

export function countTokens(content: string): number {
  // Simple token approximation for demonstration
  return Math.max(5, Math.floor(content.length / 3));
}

export function calculateUsageCost(tokens: number): string {
  // Example cost calculation for demonstration
  const pricePer1000Tokens = 0.015; // $0.015 per 1000 tokens
  return (tokens * pricePer1000Tokens / 1000).toFixed(4);
}
19. Add Request Validation Middleware (src/middleware/validateRequest.ts)

export const validateRequest = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requiredFields = ['model', 'prompt'] as const;
  
  if (!req.body || !req.body.model) {
    return res.status(400).json({
      error: { message: "Missing 'model' parameter" }
    });
  }

  if (!req.body.prompt && !req.body.messages) {
    return res.status(400).json({
      error: { message: "Missing 'prompt' or 'messages' parameter" }
    });
  }

  if (Array.isArray(req.body.messages) && 
      req.body.messages.length === 0) {
    return res.status(400).json({
      error: { message: "Messages array cannot be empty" }
    });
  }

  next();
};
20. Final Project Structure

Make sure all TypeScript type definitions are aligned
Add rate limiting to prevent abuse
Implement authentication middleware
Add Swagger documentation for API endpoints
Create a health check endpoint
Add logging middleware
Implement CORS support
To run the project:

Install dependencies:
npm install express typescript @types/node groq-sdk dotenv
Start development server:
npm run dev
Build for production:
npm run build
npm start
The final implementation provides:

Seamless API compatibility with OpenAI endpoints
Model abstraction
