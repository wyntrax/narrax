/** Central brand configuration. Nothing else in the codebase should hard-code the product name. */
export interface Brand {
  name: string;
}

export function getBrand(env: Record<string, string | undefined> = process.env): Brand {
  return { name: env.PROJECT_NAME?.trim() || 'NARRA' };
}
