import { Injectable, Logger } from '@nestjs/common';
import { RaftIntegrationService } from '../raft/raft-integration.service';
import { RaftState } from '@usex/raft';

export interface HealthStatus {
  overallStatus: 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED';
  details: {
    raft?: RaftHealthDetails;
    // system?: SystemHealthDetails; // Optional: for memory, disk later
  };
}

export interface RaftHealthDetails {
  status: 'OK' | 'NO_QUORUM' | 'NO_LEADER' | 'ERROR' | 'UNINITIALIZED';
  nodeId: string;
  currentState: RaftState | string; // string for UNINITIALIZED
  currentTerm: number | 'N/A';
  leaderId: string | null | 'N/A';
  commitIndex?: number | 'N/A';
  lastApplied?: number | 'N/A';
  peerCount?: number; // Number of other peers this node is aware of
  // "Tolerance" aspect: is part of a quorum?
  hasQuorum?: boolean;
}

@Injectable()
export class HealthcheckService {
  private readonly logger = new Logger(HealthcheckService.name);

  constructor(private readonly raftIntegrationService: RaftIntegrationService) {}

  async getHealth(): Promise<HealthStatus> {
    const raftStatusRaw = this.raftIntegrationService.getRaftNodeStatus();
    let raftHealthDetails: RaftHealthDetails;
    let overallIsHealthy = true;

    if (!raftStatusRaw || raftStatusRaw.status === 'UNINITIALIZED' || !raftStatusRaw.nodeId || raftStatusRaw.nodeId === 'N/A') {
      raftHealthDetails = {
        status: 'UNINITIALIZED',
        nodeId: this.raftIntegrationService.getNodeId() || 'N/A', // Get nodeId directly if possible
        currentState: 'UNINITIALIZED',
        currentTerm: 'N/A',
        leaderId: 'N/A',
        commitIndex: 'N/A',
        lastApplied: 'N/A',
        peerCount: 0,
        hasQuorum: false,
      };
      overallIsHealthy = false;
    } else {
      const peersFromStatus = raftStatusRaw.peers || [];
      // Assuming getPeers() returns other nodes, so +1 for self for total cluster size known to this node.
      // This is a simplification; actual cluster size from config might be better for quorum calculation.
      const perceivedClusterSize = peersFromStatus.length + 1;

      const isLeader = raftStatusRaw.state === RaftState.LEADER;
      const hasKnownLeader = !!raftStatusRaw.leaderId && raftStatusRaw.leaderId !== 'N/A';

      let currentRaftStatus: RaftHealthDetails['status'] = 'OK';
      let hasQuorum = false;

      if (isLeader) {
        // Leader has quorum if it's part of a majority of its configured peers.
        // For simplicity, a leader always considers itself as having made progress if it's leader.
        // A more robust check would use the activeConfiguration size.
        const activeConfigPeers = this.raftIntegrationService.getRaftNode()?.getPeers() || [this.raftIntegrationService.getNodeId()];
        const requiredForQuorum = Math.floor(activeConfigPeers.length / 2) + 1;
        // This is still simplified as we don't know how many peers *acknowledge* the leader.
        // For health, if it *is* leader, we'll assume it has established quorum to become leader.
        hasQuorum = activeConfigPeers.length >= requiredForQuorum || activeConfigPeers.length === 1 ;
        if (!hasQuorum) currentRaftStatus = 'NO_QUORUM';

      } else if (hasKnownLeader) {
         // Follower has quorum if connected to a leader that has quorum.
         // This is hard to determine perfectly from just follower side without more info.
         // For now, we assume if it knows a leader, it's part of a quorate system.
         hasQuorum = true;
      } else {
        currentRaftStatus = 'NO_LEADER';
        hasQuorum = false;
      }

      if (!hasQuorum) {
        overallIsHealthy = false; // If no quorum, overall unhealthy (unless it's a single node cluster starting up)
        if (perceivedClusterSize > 1) { // Only unhealthy if not a single node cluster
             currentRaftStatus = currentRaftStatus === 'OK' ? 'NO_QUORUM' : currentRaftStatus; // Don't override NO_LEADER
        } else if (perceivedClusterSize === 1 && isLeader) {
             hasQuorum = true; // Single node leader always has quorum
             currentRaftStatus = 'OK';
             overallIsHealthy = true;
        }
      }

      // If node state is ERROR or some other bad state from RaftNode itself
      // (needs RaftNode to expose more detailed error states if any)
      // For example: if (raftStatusRaw.state === RaftState.ERROR) currentRaftStatus = 'ERROR';

      raftHealthDetails = {
        status: currentRaftStatus,
        nodeId: raftStatusRaw.nodeId,
        currentState: raftStatusRaw.state as RaftState,
        currentTerm: raftStatusRaw.term,
        leaderId: raftStatusRaw.leaderId,
        commitIndex: raftStatusRaw.commitIndex,
        lastApplied: raftStatusRaw.lastApplied,
        peerCount: peersFromStatus.length,
        hasQuorum: hasQuorum,
      };
    }

    return {
      overallStatus: overallIsHealthy ? 'HEALTHY' : 'UNHEALTHY',
      details: {
        raft: raftHealthDetails,
      },
    };
  }
}
