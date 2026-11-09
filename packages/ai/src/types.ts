export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  reasoningLevel?: 'low' | 'medium' | 'high';
  /** Stable identifier for provider routing and cache affinity. Never user-authored text. */
  sessionId?: string;
  /**
   * Caller's remaining budget for this request. Providers clamp their own timeout to this value.
   * Used by multi-step callers such as the Agent to keep one turn inside its overall deadline.
   */
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Any model vendor sits behind this. The pipeline never knows which one it is talking to. */
export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {}

export interface Usage {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}
