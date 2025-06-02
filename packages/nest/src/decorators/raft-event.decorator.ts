import { SetMetadata } from "@nestjs/common";
import { RaftEventType, RAFT_EVENT_METADATA } from "../constants";
import type { RaftEventHandlerMetadata } from "../interfaces";

export function RaftEvent(eventType: RaftEventType): MethodDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    const metadata: RaftEventHandlerMetadata = {
      eventType,
      target: target.constructor,
      propertyKey,
    };

    SetMetadata(RAFT_EVENT_METADATA.HANDLER, metadata)(
      target,
      propertyKey,
      descriptor,
    );

    const existingHandlers =
      Reflect.getMetadata(RAFT_EVENT_METADATA.EVENT_TYPE, target.constructor) ||
      [];
    existingHandlers.push(metadata);
    Reflect.defineMetadata(
      RAFT_EVENT_METADATA.EVENT_TYPE,
      existingHandlers,
      target.constructor,
    );

    return descriptor;
  };
}

// Specific event decorators for better developer experience
export const OnStateChange = () => RaftEvent(RaftEventType.STATE_CHANGE);
export const OnLeaderElected = () => RaftEvent(RaftEventType.LEADER_ELECTED);
export const OnVoteGranted = () => RaftEvent(RaftEventType.VOTE_GRANTED);
export const OnVoteDenied = () => RaftEvent(RaftEventType.VOTE_DENIED);
export const OnLogReplicated = () => RaftEvent(RaftEventType.LOG_REPLICATED);
export const OnHeartbeatReceived = () =>
  RaftEvent(RaftEventType.HEARTBEAT_RECEIVED);
export const OnElectionTimeout = () =>
  RaftEvent(RaftEventType.ELECTION_TIMEOUT);
export const OnConfigurationChanged = () =>
  RaftEvent(RaftEventType.CONFIGURATION_CHANGED);
export const OnSnapshotCreated = () =>
  RaftEvent(RaftEventType.SNAPSHOT_CREATED);
export const OnErrorOccurred = () => RaftEvent(RaftEventType.ERROR_OCCURRED);
export const OnMetricsUpdated = () => RaftEvent(RaftEventType.METRICS_UPDATED);
export const OnPeerDiscovered = () => RaftEvent(RaftEventType.PEER_DISCOVERED);
export const OnPeerLost = () => RaftEvent(RaftEventType.PEER_LOST);
export const OnInstallSnapshot = () =>
  RaftEvent(RaftEventType.INSTALL_SNAPSHOT);
export const OnInstallSnapshotResponse = () =>
  RaftEvent(RaftEventType.INSTALL_SNAPSHOT_RESPONSE);
export const OnAppendEntries = () => RaftEvent(RaftEventType.APPEND_ENTRIES);
export const OnAppendEntriesResponse = () =>
  RaftEvent(RaftEventType.APPEND_ENTRIES_RESPONSE);
export const OnVoteRequest = () => RaftEvent(RaftEventType.VOTE_REQUEST);
export const OnVoteResponse = () => RaftEvent(RaftEventType.VOTE_RESPONSE);
export const OnHeartbeat = () => RaftEvent(RaftEventType.HEARTBEAT);
export const OnHeartbeatResponse = () =>
  RaftEvent(RaftEventType.HEARTBEAT_RESPONSE);
export const OnConfigurationRequest = () =>
  RaftEvent(RaftEventType.CONFIGURATION_REQUEST);
export const OnConfigurationResponse = () =>
  RaftEvent(RaftEventType.CONFIGURATION_RESPONSE);
export const OnReplicationFailure = () =>
  RaftEvent(RaftEventType.REPLICATION_FAILURE);
export const OnReplicationSuccess = () =>
  RaftEvent(RaftEventType.REPLICATION_SUCCESS);
export const OnSnapshotRequest = () =>
  RaftEvent(RaftEventType.SNAPSHOT_REQUEST);
export const OnSnapshotResponse = () =>
  RaftEvent(RaftEventType.SNAPSHOT_RESPONSE);
export const OnLogCompacted = () => RaftEvent(RaftEventType.LOG_COMPACTED);
export const OnLogTruncated = () => RaftEvent(RaftEventType.LOG_TRUNCATED);
export const OnNodeJoined = () => RaftEvent(RaftEventType.NODE_JOINED);
export const OnNodeLeft = () => RaftEvent(RaftEventType.NODE_LEFT);
export const OnMetricsCollected = () =>
  RaftEvent(RaftEventType.METRICS_COLLECTED);
export const OnHeartbeatTimeout = () =>
  RaftEvent(RaftEventType.HEARTBEAT_TIMEOUT);
export const OnConfigurationUpdate = () =>
  RaftEvent(RaftEventType.CONFIGURATION_UPDATE);
export const OnElectionStarted = () =>
  RaftEvent(RaftEventType.ELECTION_STARTED);
export const OnElectionEnded = () => RaftEvent(RaftEventType.ELECTION_ENDED);
export const OnReplicationStarted = () =>
  RaftEvent(RaftEventType.REPLICATION_STARTED);
export const OnReplicationEnded = () =>
  RaftEvent(RaftEventType.REPLICATION_ENDED);
export const OnSnapshotStarted = () =>
  RaftEvent(RaftEventType.SNAPSHOT_STARTED);
export const OnSnapshotEnded = () => RaftEvent(RaftEventType.SNAPSHOT_ENDED);
export const OnInstallSnapshotStarted = () =>
  RaftEvent(RaftEventType.INSTALL_SNAPSHOT_STARTED);
export const OnInstallSnapshotEnded = () =>
  RaftEvent(RaftEventType.INSTALL_SNAPSHOT_ENDED);
export const OnInstallSnapshotFailed = () =>
  RaftEvent(RaftEventType.INSTALL_SNAPSHOT_FAILED);
export const OnInstallSnapshotSuccess = () =>
  RaftEvent(RaftEventType.INSTALL_SNAPSHOT_SUCCESS);
export const OnVoteRequestReceived = () =>
  RaftEvent(RaftEventType.VOTE_REQUEST_RECEIVED);
export const OnVoteResponseReceived = () =>
  RaftEvent(RaftEventType.VOTE_RESPONSE_RECEIVED);
export const OnAppendEntriesReceived = () =>
  RaftEvent(RaftEventType.APPEND_ENTRIES_RECEIVED);
export const OnAppendEntriesResponseReceived = () =>
  RaftEvent(RaftEventType.APPEND_ENTRIES_RESPONSE_RECEIVED);
export const OnConfigurationRequestReceived = () =>
  RaftEvent(RaftEventType.CONFIGURATION_REQUEST_RECEIVED);
export const OnConfigurationResponseReceived = () =>
  RaftEvent(RaftEventType.CONFIGURATION_RESPONSE_RECEIVED);
export const OnSnapshotRequestReceived = () =>
  RaftEvent(RaftEventType.SNAPSHOT_REQUEST_RECEIVED);
