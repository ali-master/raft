import { Injectable, OnModuleInit, OnApplicationShutdown, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Added
import { RaftEngine, RaftNode, RaftConfiguration, RaftCommandType, RaftState, LogEntry } from '@usex/raft';
import { KvStoreService } from '../kv-store/kv-store.service';
import { KvCommandType, SetCommandPayload, DeleteCommandPayload, KvLogEntryApplicationPayload } from './kv-commands';
import { Buffer } from 'buffer';

@Injectable()
export class RaftIntegrationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RaftIntegrationService.name);
  private raftEngine: RaftEngine;
  private _raftNode: RaftNode | null = null;
  private nodeId: string;
  private raftConfig: RaftConfiguration; // Store composed config

  constructor(
    private readonly kvStoreService: KvStoreService,
    private readonly configService: ConfigService, // Injected
  ) {
    this.raftEngine = new RaftEngine();

    this.nodeId = this.configService.get<string>('RAFT_NODE_ID', 'node1'); // Provide default
    const raftHttpPort = this.configService.get<number>('RAFT_HTTP_PORT', 3001);
    const dataDir = this.configService.get<string>('RAFT_DATA_DIR', `./data/${this.nodeId}`);
    const peersEnv = this.configService.get<string>('RAFT_PEERS', '');

    let peers: string[] = [];
    if (peersEnv) {
        peers = peersEnv.split(',').map(p => {
            const parts = p.split(':');
            // Assuming format is host:port. If only host, default Raft HTTP port could be assumed or error.
            // For simplicity, expect host:port for peers from env.
            if (parts.length !== 2) {
                this.logger.warn(`Invalid peer format in RAFT_PEERS: ${p}. Expected host:port. Skipping.`);
                return null;
            }
            return `localhost:${parts[1]}`; // Assuming peers are on localhost for now
        }).filter(p => p !== null) as string[];
    }

    const defaultConfig = RaftEngine.createDefaultConfiguration(this.nodeId, 'kv-cluster');

    this.raftConfig = { // Store the config for use in onModuleInit
      ...defaultConfig,
      httpPort: raftHttpPort,
      peers: peers.length > 0 ? peers : (defaultConfig.peers || []),
      persistence: {
        ...defaultConfig.persistence,
        dataDir: dataDir,
        walEnabled: this.configService.get<boolean>('RAFT_WAL_ENABLED', true),
        enableSnapshots: this.configService.get<boolean>('RAFT_SNAPSHOTS_ENABLED', true),
      },
      snapshotThreshold: this.configService.get<number>('RAFT_SNAPSHOT_THRESHOLD', 100),
      snapshotInterval: this.configService.get<number>('RAFT_SNAPSHOT_INTERVAL', 300000),
      redis: {
         host: this.configService.get<string>('REDIS_HOST', 'localhost'),
         port: this.configService.get<number>('REDIS_PORT', 6379),
         password: this.configService.get<string>('REDIS_PASSWORD', undefined),
         db: this.configService.get<number>('REDIS_DB', 0),
      },
      nodeId: this.nodeId, // Ensure nodeId from ConfigService is used
      // Other fields will take values from defaultConfig if not overridden
    };

    this.logger.log(`RaftIntegrationService constructed for ${this.nodeId}. RaftNode initialization deferred to onModuleInit.`);
  }

  async onModuleInit(): Promise<void> {
    if (!this.raftConfig) {
        this.logger.error("Raft configuration not found for RaftNode initialization in onModuleInit.");
        throw new Error("RaftNode configuration missing during module initialization.");
    }

    try {
        this.logger.log(`Attempting to create RaftNode for ${this.nodeId} with peers: ${JSON.stringify(this.raftConfig.peers)}`);
        this._raftNode = await this.raftEngine.createNode(this.raftConfig, this.kvStoreService);
        this.logger.log(`RaftNode created for ${this.nodeId}`);
    } catch (error) {
        this.logger.error(`Failed to create RaftNode for ${this.nodeId}`, error.stack);
        throw error;
    }

    if (!this._raftNode) {
        this.logger.error(`RaftNode for ${this.nodeId} could not be initialized. Application might be unstable.`);
        throw new Error(`RaftNode ${this.nodeId} failed to initialize.`);
    }

    try {
      this.logger.log(`Starting RaftNode ${this.nodeId}...`);
      // RaftEngine.startNode expects nodeId as string
      await this.raftEngine.startNode(this.raftNode.getNodeId()); // Use getter from RaftNode instance
      this.logger.log(`RaftNode ${this.nodeId} started successfully.`);
    } catch (error) {
      this.logger.error(`Failed to start RaftNode ${this.nodeId}`, error.stack);
      throw error;
    }
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutting down RaftNode ${this.nodeId} (signal: ${signal})...`);
    if (this._raftNode) {
      try {
        await this.raftEngine.stopNode(this.nodeId);
        this.logger.log(`RaftNode ${this.nodeId} stopped.`);
      } catch (error) {
        this.logger.error(`Error stopping RaftNode ${this.nodeId}`, error.stack);
      }
    } else {
      this.logger.warn(`RaftNode ${this.nodeId} was not initialized, nothing to stop.`);
    }
  }

  private get raftNode(): RaftNode {
    if (!this._raftNode) {
        throw new Error("RaftNode has not been initialized. Accessing too early?");
    }
    return this._raftNode;
  }


  private ensureLeader(): void {
    if (!this.isLeader()) {
      const leaderId = this.getLeaderId();
      const message = leaderId
        ? `Not the leader. Current leader is ${leaderId}. Please forward request.`
        : 'Not the leader. No leader elected currently or node not initialized.';
      throw new HttpException(message, HttpStatus.MISDIRECTED_REQUEST); // MISDIRECTED_REQUEST (421) or BAD_REQUEST (400)
    }
  }

  async proposeSet(key: string, value: string): Promise<LogEntry | RaftException> { // Return type changed for more info
    this.ensureLeader();
    const commandPayload: KvLogEntryApplicationPayload = {
      type: KvCommandType.SET,
      payload: { key, value },
    };
    try {
      this.logger.debug(`Proposing SET: key=${key}`);
      // appendLog in RaftNode was changed to accept (term, commandType, commandPayload)
      // but here we should call the public RaftNode.appendLog which takes only the application payload
      // The RaftNode.appendLog itself should wrap it with term and RaftCommandType.APPLICATION
      const logEntryIndex = await this.raftNode.appendLog(commandPayload); // This should be the application payload directly
      this.logger.log(`Proposed SET: key=${key} successfully, logIndex: ${logEntryIndex}`);
      // The actual LogEntry object isn't returned by current appendLog.
      // For now, returning a success-like object or modifying appendLog is an option.
      // Let's assume appendLog returns boolean for now as per current RaftNode.
      // To return LogEntry, RaftNode.appendLog needs to be changed.
      // For now, let's return a simplified success object or throw on failure.
      // This method should ideally wait for commit for strong consistency, or return "accepted".
      // The current RaftNode.appendLog returns a boolean.
      // If it returns an index (as it was before simplification for this service):
      // return { index: logEntryIndex, term: this.raftNode.getCurrentTerm(), ...commandPayload };
      return { success: true, index: logEntryIndex } as any; // Placeholder
    } catch (error) {
      this.logger.error(`Failed to propose SET for key ${key}`, error.stack);
      throw error;
    }
  }

  async proposeDelete(key: string): Promise<LogEntry | RaftException> { // Return type changed
    this.ensureLeader();
    const commandPayload: KvLogEntryApplicationPayload = {
      type: KvCommandType.DELETE,
      payload: { key },
    };
    try {
      this.logger.debug(`Proposing DELETE: key=${key}`);
      const logEntryIndex = await this.raftNode.appendLog(commandPayload);
      this.logger.log(`Proposed DELETE: key=${key} successfully, logIndex: ${logEntryIndex}`);
      return { success: true, index: logEntryIndex } as any; // Placeholder
    } catch (error) {
      this.logger.error(`Failed to propose DELETE for key ${key}`, error.stack);
      throw error;
    }
  }

  isLeader(): boolean {
    return !!this._raftNode && this._raftNode.getState() === RaftState.LEADER;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getLeaderId(): string | null {
    return this._raftNode ? this._raftNode.getLeaderId() : null;
  }

  getRaftNodeStatus(): any {
    if (!this._raftNode) return { status: 'UNINITIALIZED', nodeId: this.nodeId };
    return {
        nodeId: this.nodeId,
        state: this.raftNode.getState(),
        term: this.raftNode.getCurrentTerm(),
        leaderId: this.raftNode.getLeaderId(),
        commitIndex: this.raftNode.getCommitIndex(),
        lastApplied: this.raftNode.getLastApplied(),
        peers: this.raftNode.getPeers()
    };
  }
}
