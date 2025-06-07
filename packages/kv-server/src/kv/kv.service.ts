import { Injectable, Logger } from '@nestjs/common';
// RaftIntegrationService is not needed here anymore for GET
import { KvStoreService } from '../kv-store/kv-store.service'; // The StateMachine
import { EncryptionService } from '../encryption/encryption.service'; // Added

@Injectable()
export class KvService {
  private readonly logger = new Logger(KvService.name);

  constructor(
    private readonly kvStoreService: KvStoreService, // For direct reads from local state
    private readonly encryptionService: EncryptionService, // Added
  ) {}

  // set() method removed

  async get(key: string): Promise<string | null> {
    this.logger.log(`Attempting to get key: ${key}`);
    const encryptedValue = this.kvStoreService.get(key); // Reads from local state machine

    if (encryptedValue === undefined || encryptedValue === null) {
      // The controller will handle throwing NotFoundException if value is null.
      return null;
    }

    // Decryption will be added here in a later step
    const decryptedValue = this.encryptionService.decrypt(encryptedValue);
    return decryptedValue;
  }

  // delete() method removed
}
