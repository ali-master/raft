import { it, expect, describe } from "vitest";
import {
  RaftValidationException,
  RaftStorageException,
  RaftReplicationException,
  RaftNetworkException,
  RaftLeaderException,
  RaftException,
  RaftElectionException,
  RaftConfigurationException,
} from "../../src/exceptions";

describe("exception Classes", () => {
  it("should create RaftException with proper properties", () => {
    const error = new RaftException("Test error", "test-node");
    expect(error.message).toBe("Test error");
    expect(error.nodeId).toBe("test-node");
    expect(error.timestamp).toBeInstanceOf(Date);
    expect(error.name).toBe("RaftException");
  });

  it("should create specialized exceptions", () => {
    const validationError = new RaftValidationException(
      "Validation failed",
      "node1",
    );
    expect(validationError.name).toBe("RaftValidationException");
    expect(validationError.nodeId).toBe("node1");

    const networkError = new RaftNetworkException("Network error", "node2");
    expect(networkError.name).toBe("RaftNetworkException");

    const storageError = new RaftStorageException("Storage error", "node3");
    expect(storageError.name).toBe("RaftStorageException");

    const replicationError = new RaftReplicationException(
      "Replication error",
      "node4",
    );
    expect(replicationError.name).toBe("RaftReplicationException");

    const configError = new RaftConfigurationException("Config error", "node5");
    expect(configError.name).toBe("RaftConfigurationException");

    const leaderError = new RaftLeaderException("Leader error", "node6");
    expect(leaderError.name).toBe("RaftLeaderException");

    const electionError = new RaftElectionException("Election error", "node7");
    expect(electionError.name).toBe("RaftElectionException");
  });
});
