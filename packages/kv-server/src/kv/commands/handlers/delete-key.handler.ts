import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteKeyCommand } from '../impl/delete-key.command';
import { RaftIntegrationService } from '../../../raft/raft-integration.service';
import { Logger } from '@nestjs/common';

@CommandHandler(DeleteKeyCommand)
export class DeleteKeyHandler implements ICommandHandler<DeleteKeyCommand> {
  private readonly logger = new Logger(DeleteKeyHandler.name);

  constructor(private readonly raftIntegrationService: RaftIntegrationService) {}

  async execute(command: DeleteKeyCommand): Promise<void> {
    const { key } = command;
    this.logger.log(`Handling DeleteKeyCommand for key: ${key}`);
    await this.raftIntegrationService.proposeDelete(key);
  }
}
