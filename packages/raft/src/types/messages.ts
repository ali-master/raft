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

export interface InstallSnapshotRequest {
  term: number;
  leaderId: string;
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  offset: number;
  data: Buffer;
  done: boolean;
}

export interface InstallSnapshotResponse {
  term: number;
}

export interface PreVoteRequest {
  term: number; // Candidate's prospective term (currentTerm + 1)
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface PreVoteResponse {
  term: number;     // Responder's current term
  voteGranted: boolean;
}

export interface TimeoutNowRequest {
  term: number;     // Leader's current term
  leaderId: string; // Leader's ID
}
