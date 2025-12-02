export type Store<T = Record<string, any>> = T;

export type Action = string | null;

export type Params = Record<string, any>;

export interface NodeConfig {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export const DEFAULT_NODE_CONFIG: Required<NodeConfig> = {
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 60000,
};
