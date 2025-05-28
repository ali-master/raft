export interface LogEntry {
  term: number;
  index: number;
  command: any;
  timestamp: Date;
  checksum: string;
}
