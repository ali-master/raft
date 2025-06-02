import type { Provider } from "@nestjs/common";
import { RaftEngine } from "@usex/raft";
import { RAFT_ENGINE } from "../constants";

export const raftEngineProvider: Provider = {
  provide: RAFT_ENGINE,
  useFactory: () => {
    return new RaftEngine();
  },
};
