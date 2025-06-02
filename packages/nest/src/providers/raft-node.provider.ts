import type { Provider } from "@nestjs/common";
import type { RaftNode } from "@usex/raft";
import { RaftEngine } from "@usex/raft";
import { RAFT_NODE, RAFT_MODULE_OPTIONS, RAFT_ENGINE } from "../constants";
import type { RaftModuleOptions } from "../interfaces";

export const raftNodeProvider: Provider = {
  provide: RAFT_NODE,
  useFactory: async (
    engine: RaftEngine,
    options: RaftModuleOptions,
  ): Promise<RaftNode> => {
    const config = RaftEngine.createDefaultConfiguration(
      options.nodeId,
      options.clusterId,
    );

    // Merge with user options
    const finalConfig = {
      ...config,
      ...options,
      nodeId: options.nodeId,
      clusterId: options.clusterId,
    };

    return engine.createNode(finalConfig);
  },
  inject: [RAFT_ENGINE, RAFT_MODULE_OPTIONS],
};

export function createRaftNodeProvider(nodeId: string): Provider {
  return {
    provide: Symbol.for(`RAFT_NODE_${nodeId}`),
    useFactory: async (engine: RaftEngine): Promise<RaftNode | undefined> => {
      return engine.getNode(nodeId);
    },
    inject: [RAFT_ENGINE],
  };
}
