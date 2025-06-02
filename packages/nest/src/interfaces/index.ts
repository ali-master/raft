import type { Type } from "@nestjs/common";
import type { ModuleMetadata } from "@nestjs/common/interfaces";
import type { RaftConfiguration } from "@usex/raft";
import type { RaftEventType } from "../constants";

export interface RaftModuleOptions extends Partial<RaftConfiguration> {
  nodeId: string;
  clusterId: string;
  isGlobal?: boolean;
}

export interface RaftModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  isGlobal?: boolean;
  useClass?: Type<RaftOptionsFactory>;
  useExisting?: Type<RaftOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<RaftModuleOptions> | RaftModuleOptions;
  inject?: any[];
}

export interface RaftOptionsFactory {
  createRaftOptions: () => Promise<RaftModuleOptions> | RaftModuleOptions;
}

export interface RaftEventHandler {
  (event: any): void | Promise<void>;
}

export interface RaftEventHandlerMetadata {
  eventType: RaftEventType;
  target: any;
  propertyKey: string | symbol;
}

export interface RaftNodeMetadata {
  nodeId?: string;
  target: any;
}
