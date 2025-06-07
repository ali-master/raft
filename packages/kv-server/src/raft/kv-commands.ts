export enum KvCommandType {
  SET = 'SET',
  DELETE = 'DELETE',
}

export interface SetCommandPayload {
  key: string;
  value: string; // This will be the encrypted value eventually
}

export interface DeleteCommandPayload {
  key: string;
}

// This type will be used as the `commandPayload.payload` for an APPLICATION log entry
export type KvApplicationPayload = SetCommandPayload | DeleteCommandPayload;

// This is the structure that will go into LogEntry.commandPayload when commandType is APPLICATION
// and the application is our KV store.
export interface KvLogEntryApplicationPayload {
  type: KvCommandType; // SET or DELETE
  payload: KvApplicationPayload;
}
