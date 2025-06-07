import { Injectable, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Added
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private key: Buffer;

  constructor(private readonly configService: ConfigService) {
    // Key initialization moved to onModuleInit to ensure ConfigService is ready
  }

  onModuleInit(): void {
    const encryptionKeyString = this.configService.get<string>('KV_ENCRYPTION_KEY');

    if (!encryptionKeyString) {
      const errMsg = 'KV_ENCRYPTION_KEY is not defined in environment or .env file. Encryption service cannot operate.';
      this.logger.error(errMsg);
      throw new Error(errMsg); // Fatal error, stop startup
    }

    // Determine if the key is hex encoded or a direct string
    if (encryptionKeyString.length === 64 && /^[0-9a-fA-F]+$/.test(encryptionKeyString)) {
        this.key = Buffer.from(encryptionKeyString, 'hex');
        this.logger.log('Encryption key loaded from hex string.');
    } else {
        // Assume UTF-8 if not 64-char hex. Let Buffer.from handle it.
        // The length check below will validate if it resulted in 32 bytes.
        this.key = Buffer.from(encryptionKeyString, 'utf-8');
        this.logger.log('Encryption key loaded from UTF-8 string.');
    }

    if (this.key.length !== 32) {
        const errMsg = `Encryption key (from KV_ENCRYPTION_KEY) must resolve to 32 bytes (256 bits). Current key length: ${this.key.length} bytes. Ensure it's a 32-character UTF-8 string or a 64-character hex string.`;
        this.logger.error(errMsg);
        throw new Error(errMsg); // Fatal error
    }
    this.logger.log(`EncryptionService initialized successfully. Key length: ${this.key.length} bytes.`);
  }

  encrypt(text: string): string {
    if (text === null || text === undefined) {
        this.logger.warn('Attempted to encrypt null or undefined value. Returning as is.');
        // Or throw error, depending on desired handling for null/undefined inputs
        return text;
    }
    try {
      const iv = crypto.randomBytes(12); // 96 bits is recommended for GCM
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      // Store as iv:authtag:ciphertext (all hex encoded)
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      this.logger.error('Encryption failed', error.stack);
      throw new InternalServerErrorException('Encryption process failed.');
    }
  }

  decrypt(encryptedText: string): string {
    if (encryptedText === null || encryptedText === undefined) {
        this.logger.warn('Attempted to decrypt null or undefined value. Returning as is.');
        return encryptedText;
    }
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        this.logger.error(`Invalid encrypted text format for decryption: ${encryptedText.substring(0,50)}...`);
        // This could indicate data corruption or that the data was not encrypted by this system.
        // Depending on policy, you might return the original text, throw a specific error, or return null.
        // Throwing an error is safer to indicate failure.
        throw new Error('Invalid encrypted text format. Expected iv:authtag:ciphertext.');
      }
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed for text starting with: ${encryptedText.substring(0, 50)}...`, error.stack);
      if (error.message.toLowerCase().includes('unsupported state') || error.message.toLowerCase().includes('bad auth tag')) {
         throw new InternalServerErrorException('Decryption failed: authentication tag mismatch or invalid data.');
      }
      throw new InternalServerErrorException('Decryption process failed due to an unexpected error.');
    }
  }
}
