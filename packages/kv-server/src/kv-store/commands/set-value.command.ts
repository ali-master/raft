import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler, ICommand } from "@nestjs/cqrs";
import { Injectable } from "@nestjs/common";
import type { RaftService } from "../../raft/raft.service";
import type { KVOperation } from "../kv-state-machine";

export class SetValueCommand implements ICommand {
  constructor(
    public readonly key: string,
    public readonly value: string,
  ) {}
}

@Injectable()
@CommandHandler(SetValueCommand)
export class SetValueHandler implements ICommandHandler<SetValueCommand> {
  constructor(private readonly raftService: RaftService) {}

  async execute(command: SetValueCommand): Promise<void> {
    const operation: KVOperation = {
      type: "SET",
      key: command.key,
      value: command.value,
    };

    await this.raftService.apply(JSON.stringify(operation));
  }
}
