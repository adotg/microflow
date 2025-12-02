import { Action, NodeConfig, Params, DEFAULT_NODE_CONFIG } from './types';

export abstract class Node<TStore = any, TPrepItem = any, TExecResult = any> {
  readonly config: Required<NodeConfig>;
  protected params: Params = {};
  private edges: Map<Action, Node> = new Map();

  constructor(config?: NodeConfig) {
    this.config = { ...DEFAULT_NODE_CONFIG, ...config };
  }

  abstract prep(store: TStore): AsyncGenerator<TPrepItem | Promise<TPrepItem>>;

  abstract exec(store: TStore, item: TPrepItem): Promise<TExecResult>;

  abstract post( store: TStore, prepItems: TPrepItem[], execResults: TExecResult[]): Promise<Action>;

  execFallback?(store: TStore, item: TPrepItem, error: Error): Promise<TExecResult>;

  connect(action: Action | Node, target?: Node): this {
    if (target === undefined) {
      this.edges.set('default', action as Node);
    } else {
      this.edges.set(action as Action, target);
    }
    return this;
  }

  getEdge(action: Action): Node | undefined {
    return this.edges.get(action);
  }

  setParams(params: Params): this {
    this.params = { ...params };
    return this;
  }
}
