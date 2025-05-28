import type { LogEntry } from "./log";

export interface VoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
  weight?: number;
}

export interface VoteResponse {
  term: number;
  voteGranted: boolean;
  voterWeight: number;
}

export interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
  lastLogIndex: number;
}
