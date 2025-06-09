import { Injectable } from "@nestjs/common";
import type { QueryBus, EventBus, CommandBus } from "@nestjs/cqrs";
import type { EncryptionService } from "../encryption/encryption.service";
import { SetValueCommand } from "./commands/set-value.command";
import { GetValueQuery } from "./queries/get-value.query";
import { DeleteValueCommand } from "./commands/delete-value.command";
import { ListKeysQuery } from "./queries/list-keys.query";
import { ValueDeletedEvent } from "./events/value-deleted.event";
import { ValueSetEvent } from "./events/value-set.event";

@Injectable()
export class KVStoreService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly eventBus: EventBus,
    private readonly encryptionService: EncryptionService,
  ) {}

  async setValue(key: string, value: string): Promise<void> {
    const encryptedValue = this.encryptionService.encrypt(value);
    await this.commandBus.execute(new SetValueCommand(key, encryptedValue));
    await this.eventBus.publish(new ValueSetEvent(key));
  }

  async getValue(key: string): Promise<string | null> {
    const encryptedValue = await this.queryBus.execute(new GetValueQuery(key));
    if (!encryptedValue) return null;
    return this.encryptionService.decrypt(encryptedValue);
  }

  async deleteValue(key: string): Promise<void> {
    await this.commandBus.execute(new DeleteValueCommand(key));
    await this.eventBus.publish(new ValueDeletedEvent(key));
  }

  async listKeys(): Promise<string[]> {
    return this.queryBus.execute(new ListKeysQuery());
  }

  async isHealthy(): Promise<boolean> {
    const { ErrorHandler } = await import("../shared");
    return ErrorHandler.safeExecuteWithBoolean(async () => {
      const testKey = "health-check";
      const testValue = "test-value";
      await this.setValue(testKey, testValue);
      const retrievedValue = await this.getValue(testKey);
      await this.deleteValue(testKey);
      if (retrievedValue !== testValue) {
        throw new Error("KV store test operation failed");
      }
    });
  }
}
