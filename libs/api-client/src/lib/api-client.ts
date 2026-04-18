/**
 * takeAway API client — typed wrapper around the NestJS OpenAPI spec.
 * Will be code-generated from apps/api Swagger schema in later milestones.
 */

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken?: () => string | null;
}

export function createApiClient(config: ApiClientConfig): ApiClientConfig {
  return config;
}
