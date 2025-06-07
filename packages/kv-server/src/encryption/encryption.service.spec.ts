import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

// Mock Logger to suppress actual logging during tests if desired
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  return {
    ...actual,
    Logger: class MockLogger {
      log = vi.fn();
      warn = vi.fn();
      error = vi.fn();
      debug = vi.fn();
      verbose = vi.fn();
      static log = vi.fn(); // For static calls if any
    },
  };
});


describe('EncryptionService', () => {
  let service: EncryptionService;
  let configService: ConfigService;

  const mockConfigService = {
    get: vi.fn(),
  };

  // Generate a random 32-byte key for each test run for isolation
  const validKey = crypto.randomBytes(32).toString('hex'); // Use hex for env representation
  const anotherValidKey = crypto.randomBytes(32).toString('hex');

  beforeEach(async () => {
    // Reset mocks before each test
    mockConfigService.get.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Initialization', () => {
    it('should initialize with a valid key from ConfigService (hex)', () => {
      mockConfigService.get.mockReturnValue(validKey);
      service = new EncryptionService(configService);
      service.onModuleInit(); // Manually call for testing constructor logic moved to onModuleInit
      expect(service).toBeDefined();
      // @ts-ignore access private member for test
      expect(service.key.length).toBe(32);
    });

    it('should initialize with a valid key from ConfigService (utf-8, 32 chars)', () => {
      const utf8Key = 'abcdefghijklmnopqrstuvwxyz123456'; // 32 chars
      mockConfigService.get.mockReturnValue(utf8Key);
      service = new EncryptionService(configService);
      service.onModuleInit();
      expect(service).toBeDefined();
      // @ts-ignore
      expect(service.key.length).toBe(32);
       // @ts-ignore
      expect(service.key.toString('utf-8')).toBe(utf8Key);
    });

    it('should throw error if KV_ENCRYPTION_KEY is not defined', () => {
      mockConfigService.get.mockReturnValue(undefined);
      expect(() => {
        service = new EncryptionService(configService);
        service.onModuleInit();
      }).toThrow('KV_ENCRYPTION_KEY is not defined');
    });

    it('should throw error if key is not 32 bytes (e.g., short string)', () => {
      mockConfigService.get.mockReturnValue('shortkey');
      expect(() => {
        service = new EncryptionService(configService);
        service.onModuleInit();
      }).toThrow('Encryption key (from KV_ENCRYPTION_KEY) must resolve to 32 bytes');
    });

    it('should throw error if key is not 32 bytes (e.g., short hex)', () => {
      mockConfigService.get.mockReturnValue('abcdef0123'); // 10 hex chars = 5 bytes
      expect(() => {
        service = new EncryptionService(configService);
        service.onModuleInit();
      }).toThrow('Encryption key (from KV_ENCRYPTION_KEY) must resolve to 32 bytes');
    });
  });

  describe('encrypt and decrypt', () => {
    beforeEach(() => {
      // Ensure service is initialized with a valid key for these tests
      mockConfigService.get.mockReturnValue(validKey);
      service = new EncryptionService(configService);
      service.onModuleInit();
    });

    it('should encrypt text into iv:authTag:ciphertext format', () => {
      const plaintext = 'hello world';
      const encrypted = service.encrypt(plaintext);
      expect(encrypted).toBeDefined();
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(24); // IV for GCM is typically 12 bytes, so 24 hex chars
      expect(parts[1].length).toBe(32); // AuthTag for GCM is typically 16 bytes, so 32 hex chars
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('should correctly decrypt an encrypted string', () => {
      const plaintext = 'my secret data';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt various string lengths', () => {
        const testStrings = ["short", "", "a much longer string with various characters !@#$%^&*()_+[]{}|;:',./<>?`~"];
        for (const str of testStrings) {
            const encrypted = service.encrypt(str);
            const decrypted = service.decrypt(encrypted);
            expect(decrypted).toBe(str);
        }
    });

    it('should return null or undefined as is for encrypt/decrypt', () => {
      expect(service.encrypt(null as any)).toBeNull();
      expect(service.encrypt(undefined as any)).toBeUndefined();
      expect(service.decrypt(null as any)).toBeNull();
      expect(service.decrypt(undefined as any)).toBeUndefined();
    });

    it('decrypt should throw for invalid format (not enough parts)', () => {
      expect(() => service.decrypt('invalidformat')).toThrow('Invalid encrypted text format.');
    });

    it('decrypt should throw for invalid format (IV not hex)', () => {
      const plaintext = 'test';
      const encrypted = service.encrypt(plaintext);
      const parts = encrypted.split(':');
      const malformedEncrypted = `nothex:${parts[1]}:${parts[2]}`;
      expect(() => service.decrypt(malformedEncrypted)).toThrow('Decryption process failed'); // crypto error
    });

    it('decrypt should throw if authTag is tampered', () => {
      const plaintext = 'test auth tag';
      const encrypted = service.encrypt(plaintext);
      const parts = encrypted.split(':');
      let tamperedAuthTag = Buffer.from(parts[1], 'hex');
      tamperedAuthTag[0] = tamperedAuthTag[0] ^ 0xff; // Flip some bits
      const malformedEncrypted = `${parts[0]}:${tamperedAuthTag.toString('hex')}:${parts[2]}`;

      expect(() => service.decrypt(malformedEncrypted)).toThrow('Decryption failed: authentication tag mismatch or invalid data.');
    });

    it('decrypt should throw if ciphertext is tampered', () => {
      const plaintext = 'test ciphertext';
      const encrypted = service.encrypt(plaintext);
      const parts = encrypted.split(':');
      let tamperedCipher = Buffer.from(parts[2], 'hex');
      tamperedCipher[0] = tamperedCipher[0] ^ 0xff; // Flip some bits
      const malformedEncrypted = `${parts[0]}:${parts[1]}:${tamperedCipher.toString('hex')}`;

      expect(() => service.decrypt(malformedEncrypted)).toThrow('Decryption failed: authentication tag mismatch or invalid data.');
    });

    it('decrypt should throw if different key is used', () => {
      const plaintext = 'test key change';
      const encryptedWithKey1 = service.encrypt(plaintext);

      // Create new service instance with a different key
      mockConfigService.get.mockReturnValue(anotherValidKey);
      const serviceWithKey2 = new EncryptionService(configService);
      serviceWithKey2.onModuleInit();

      expect(() => serviceWithKey2.decrypt(encryptedWithKey1)).toThrow('Decryption failed: authentication tag mismatch or invalid data.');
    });
  });
});
