import { Injectable } from "@nestjs/common";
import { RAFT_METADATA } from "../constants";
import type { RaftNodeMetadata } from "../interfaces";

export function RaftNode(nodeId?: string): ClassDecorator {
  return (target: any) => {
    const metadata: RaftNodeMetadata = {
      nodeId,
      target,
    };

    Reflect.defineMetadata(RAFT_METADATA.NODE, metadata, target);
    Injectable()(target);
  };
}
