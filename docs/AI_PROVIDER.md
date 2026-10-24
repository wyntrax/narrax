# Model provider (agent chat and analysis): Vikey flow

One OpenAI-compatible request, built by `aiProviderFromEnv()` (`packages/ai/src/fromEnv.ts`) and used by both `apps/api` (chat) and
`workers/pipeline` (analysis, screening, position review):

```
POST {AI_BASE_URL}/chat/completions          default AI_BASE_URL = https://api.vikey.ai/v1
Authorization: Bearer {AI_PROVIDER_API_KEY}
{"model": "{model id}", "messages": [{"role":"system",...},{"role":"user",...}], ...}
```

## Settings (environment, server side only)

| Variable | Meaning |
|---|---|
| `AI_PROVIDER_API_KEY` | The key. Without it chat answers 503 `CHAT_UNAVAILABLE` and analysis stays off. |
| `AI_BASE_URL` | Default `https://api.vikey.ai/v1`. A trailing slash or a pasted `/chat/completions` is tolerated. It must end in `/v1`. |
| `AI_MODEL_ID` | A model id Vikey lists for your key. Becomes the default fast and reasoning model until admin AI settings are saved. **Saved settings (`ai.models`) win**, so if you saved the placeholder defaults earlier, change them in the admin AI settings instead. |
| `AI_REQUEST_STYLE` | `standard` (default): model, messages, temperature, max_tokens. `bare`: exactly the curl example, model and messages only. `full`: also JSON mode and `reasoning_effort` (the old behavior). |

The chat uses the **fast** model (`fastModel`). The built-in names (`gpt-6-luna`, `gpt-6-sol`) are placeholders a real provider rejects.

```powershell
$env:AI_PROVIDER_API_KEY='YOUR_KEY'
$env:AI_BASE_URL='https://api.vikey.ai/v1'
$env:AI_MODEL_ID='MODEL_ID'
npm run dev:api
npm run dev:workers      # only if you want analysis too; it reads the same variables
```

## What happens on errors

- HTTP 400 or 422: the client retries once with the `bare` request and remembers that for the model. If `bare` also fails the error is
  `HTTP 400 (the model id or a request field was rejected)`, which usually means a wrong model id.
- 401 or 403: `check AI_PROVIDER_API_KEY` (and model access). 404: `check AI_BASE_URL (it should end in /v1) and the model id`. 429: rate limit or credit.
- The user sees only the fixed fallback message. The API logs `chat model call failed` with `llmError` (fixed text above) and the model id, and stores
  it in the assistant message `meta`. The provider's response body and the key are never logged or stored.
- The model must answer with JSON for the agent loop. `extractJson` tolerates a code fence or a sentence around it, and bad output is retried a couple of
  times before a fixed message. If a model keeps replying in prose, choose another model id or use `AI_REQUEST_STYLE=full` where the provider supports JSON mode.

## Not verified

No request to Vikey has been made from this codebase's build environment (no network). The request shape follows the provider's curl example and the
common chat-completions format. First real call: send one chat message and read the API log for `chat model call failed`.
