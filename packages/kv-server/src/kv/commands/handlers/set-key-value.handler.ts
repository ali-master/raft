import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { SetKeyValueCommand } from '../impl/set-key-value.command';
import { RaftIntegrationService } from '../../../raft/raft-integration.service';
import { EncryptionService } from '../../../encryption/encryption.service'; // Added
import { Logger } from '@nestjs/common';

@CommandHandler(SetKeyValueCommand)
export class SetKeyValueHandler implements ICommandHandler<SetKeyValueCommand> {
  private readonly logger = new Logger(SetKeyValueHandler.name);

  constructor(
    private readonly raftIntegrationService: RaftIntegrationService,
    private readonly encryptionService: EncryptionService, // Added
  ) {}

  async execute(command: SetKeyValueCommand): Promise<void> {
    const { key, value } = command;
    this.logger.log(`Handling SetKeyValueCommand for key: ${key}`);
    const encryptedValue = this.encryptionService.encrypt(value);
    this.logger.debug(`Encrypted value for key ${key}: ${encryptedValue.substring(0, 50)}...`);
    await this.raftIntegrationService.proposeSet(key, encryptedValue);
  }
}
