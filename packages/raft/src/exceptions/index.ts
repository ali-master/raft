export class RaftException extends Error {
  public readonly timestamp: Date;
  public readonly nodeId: string;

  constructor(message: string, nodeId: string = "") {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.nodeId = nodeId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RaftElectionException extends RaftException {}
export class RaftReplicationException extends RaftException {}
export class RaftConfigurationException extends RaftException {}
export class RaftNetworkException extends RaftException {}
export class RaftStorageException extends RaftException {}
export class RaftTimeoutException extends RaftException {}
export class RaftValidationException extends RaftException {}
export class RaftPeerDiscoveryException extends RaftException {}
export class RaftLeaderException extends RaftException {}
