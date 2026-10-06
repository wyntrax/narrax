export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  reasoningLevel?: 'low' | 'medium' | 'high';
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
