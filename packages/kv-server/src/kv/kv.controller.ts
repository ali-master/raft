import { Controller, Get, Put, Delete, Param, Body, HttpCode, HttpStatus, NotFoundException, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { KvService } from './kv.service'; // Still needed for GET
import { SetKvDto } from './dto/set-kv.dto';
import { SetKeyValueCommand } from './commands/impl/set-key-value.command';
import { DeleteKeyCommand } from './commands/impl/delete-key.command';

// Basic key validation (e.g., alphanumeric, no spaces, within length limits)
// More complex validation can be done via a custom Pipe if needed.
const KEY_REGEX = /^[a-zA-Z0-9_-]{1,255}$/;

// Custom Pipe for Key Validation
import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';

@Injectable()
export class KeyValidationPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!KEY_REGEX.test(value)) {
      throw new BadRequestException(`Invalid key format for "${value}". Keys must be 1-255 chars, alphanumeric, underscores, or hyphens.`);
    }
    return value;
  }
}


@Controller('kv')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class KvController {
  private readonly logger = new Logger(KvController.name);

  constructor(
    private readonly kvService: KvService, // For GET operations
    private readonly commandBus: CommandBus, // For PUT/DELETE operations
  ) {}

  @Put(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async set(@Param('key', KeyValidationPipe) key: string, @Body() body: SetKvDto): Promise<void> {
    this.logger.log(`PUT /kv/${key} - value length: ${body.value.length}`);
    await this.commandBus.execute(new SetKeyValueCommand(key, body.value));
  }

  @Get(':key')
  async get(@Param('key', KeyValidationPipe) key: string): Promise<{ key: string; value: string }> {
    this.logger.log(`GET /kv/${key}`);
    const value = await this.kvService.get(key);
    if (value === null) {
      throw new NotFoundException(`Key "${key}" not found`);
    }
    return { key, value };
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('key', KeyValidationPipe) key: string): Promise<void> {
    this.logger.log(`DELETE /kv/${key}`);
    await this.commandBus.execute(new DeleteKeyCommand(key));
  }
}
