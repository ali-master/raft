import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler, IQuery } from "@nestjs/cqrs";
import { Injectable } from "@nestjs/common";
import type { KVStateMachine } from "../kv-state-machine";

export class GetValueQuery implements IQuery {
  constructor(public readonly key: string) {}
}

@Injectable()
@QueryHandler(GetValueQuery)
export class GetValueHandler implements IQueryHandler<GetValueQuery> {
  constructor(private readonly stateMachine: KVStateMachine) {}

  async execute(query: GetValueQuery): Promise<string | null> {
    return this.stateMachine.getValue(query.key);
  }
}
