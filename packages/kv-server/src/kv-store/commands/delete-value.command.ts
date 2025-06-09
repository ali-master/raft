import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler, ICommand } from "@nestjs/cqrs";
import { Injectable } from "@nestjs/common";
import type { RaftService } from "../../raft/raft.service";
import type { KVOperation } from "../kv-state-machine";

export class DeleteValueCommand implements ICommand {
  constructor(public readonly key: string) {}
}

@Injectable()
@CommandHandler(DeleteValueCommand)
export class DeleteValueHandler implements ICommandHandler<DeleteValueCommand> {
  constructor(private readonly raftService: RaftService) {}

  async execute(command: DeleteValueCommand): Promise<void> {
    const operation: KVOperation = {
      type: "DELETE",
      key: command.key,
    };

    await this.raftService.apply(JSON.stringify(operation));
  }
}
