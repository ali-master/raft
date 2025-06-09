import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler, IQuery } from "@nestjs/cqrs";
import { Injectable } from "@nestjs/common";
import type { KVStateMachine } from "../kv-state-machine";

export class ListKeysQuery implements IQuery {}

@Injectable()
@QueryHandler(ListKeysQuery)
export class ListKeysHandler implements IQueryHandler<ListKeysQuery> {
  constructor(private readonly stateMachine: KVStateMachine) {}

  async execute(_: ListKeysQuery): Promise<string[]> {
    return this.stateMachine.listKeys();
  }
}
