export interface ValidationResult {
  ok: boolean;
  error?: string;
  messages?: A2uiMessage[];
  surfaceId?: string;
}

export interface A2uiMessage {
  version: string;
  createSurface?: {
    surfaceId: string;
    catalogId?: string;
    components?: Record<string, unknown>[];
  };
  updateComponents?: {
    surfaceId: string;
    components: Record<string, unknown>[];
  };
  updateDataModel?: {
    surfaceId: string;
    path?: string;
    value: unknown;
  };
  deleteSurface?: {
    surfaceId: string;
  };
  callRendererFunction?: Record<string, unknown>;
}
