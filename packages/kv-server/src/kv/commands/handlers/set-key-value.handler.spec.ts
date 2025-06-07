import { Test, TestingModule } from '@nestjs/testing';
import { SetKeyValueHandler } from './set-key-value.handler';
import { SetKeyValueCommand } from '../impl/set-key-value.command';
import { RaftIntegrationService } from '../../../raft/raft-integration.service';
import { EncryptionService } from '../../../encryption/encryption.service';
import { Logger } from '@nestjs/common';

// Mock Logger
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  return {
    ...actual,
    Logger: class MockLogger {
      log = vi.fn();
      warn = vi.fn();
      error = vi.fn();
      debug = vi.fn();
    },
  };
});

describe('SetKeyValueHandler', () => {
  let handler: SetKeyValueHandler;
  let raftIntegrationService: RaftIntegrationService;
  let encryptionService: EncryptionService;

  const mockRaftIntegrationService = {
    proposeSet: vi.fn(),
  };

  const mockEncryptionService = {
    encrypt: vi.fn(),
    decrypt: vi.fn(), // Not used by this handler but part of the service
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetKeyValueHandler,
        {
          provide: RaftIntegrationService,
          useValue: mockRaftIntegrationService,
        },
        {
          provide: EncryptionService,
          useValue: mockEncryptionService,
        },
      ],
    }).compile();

    handler = module.get<SetKeyValueHandler>(SetKeyValueHandler);
    raftIntegrationService = module.get<RaftIntegrationService>(RaftIntegrationService);
    encryptionService = module.get<EncryptionService>(EncryptionService);

    // Reset mocks before each test
    mockRaftIntegrationService.proposeSet.mockClear();
    mockEncryptionService.encrypt.mockClear();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  describe('execute', () => {
    it('should call encryptionService.encrypt and raftIntegrationService.proposeSet with correct parameters', async () => {
      const command = new SetKeyValueCommand('testKey', 'testValue');
      const encryptedValue = 'encryptedTestValue';
      mockEncryptionService.encrypt.mockReturnValue(encryptedValue);
      mockRaftIntegrationService.proposeSet.mockResolvedValue(undefined as any); // Simulate successful proposal

      await handler.execute(command);

      expect(encryptionService.encrypt).toHaveBeenCalledTimes(1);
      expect(encryptionService.encrypt).toHaveBeenCalledWith(command.value);

      expect(raftIntegrationService.proposeSet).toHaveBeenCalledTimes(1);
      expect(raftIntegrationService.proposeSet).toHaveBeenCalledWith(command.key, encryptedValue);
    });

    it('should propagate errors from raftIntegrationService.proposeSet', async () => {
      const command = new SetKeyValueCommand('testKey', 'testValue');
      const encryptedValue = 'encryptedTestValue';
      const expectedError = new Error('Raft proposal failed');
      mockEncryptionService.encrypt.mockReturnValue(encryptedValue);
      mockRaftIntegrationService.proposeSet.mockRejectedValue(expectedError);

      await expect(handler.execute(command)).rejects.toThrow(expectedError);
    });

    it('should propagate errors from encryptionService.encrypt', async () => {
      const command = new SetKeyValueCommand('testKey', 'testValue');
      const expectedError = new Error('Encryption failed');
      mockEncryptionService.encrypt.mockImplementation(() => {
        throw expectedError;
      });

      await expect(handler.execute(command)).rejects.toThrow(expectedError);
      expect(raftIntegrationService.proposeSet).not.toHaveBeenCalled();
    });
  });
});
