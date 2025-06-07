export enum RaftCommandType {
  APPLICATION = "APPLICATION", // For regular client commands
  CHANGE_CONFIG = "CHANGE_CONFIG",
}

export interface LogEntry {
  term: number;
  index: number;
  commandType: RaftCommandType;
  commandPayload: any; // Can be application-specific command or ConfigurationChangePayload
  timestamp: Date;
  checksum: string;
}

export interface ConfigurationChangePayload {
  // If oldPeers is present, it's a C_old,new (joint) configuration.
  // oldPeers lists servers in C_old.
  // newPeers lists servers in C_new.
  //
  // If oldPeers is undefined/omitted, it's a C_new (final) configuration.
  // newPeers lists servers in C_new.
  oldPeers?: string[];
  newPeers: string[];
}
