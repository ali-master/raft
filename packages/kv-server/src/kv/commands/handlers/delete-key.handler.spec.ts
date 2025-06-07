import { Test, TestingModule } from '@nestjs/testing';
import { DeleteKeyHandler } from './delete-key.handler';
import { DeleteKeyCommand } from '../impl/delete-key.command';
import { RaftIntegrationService } from '../../../raft/raft-integration.service';
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

describe('DeleteKeyHandler', () => {
  let handler: DeleteKeyHandler;
  let raftIntegrationService: RaftIntegrationService;

  const mockRaftIntegrationService = {
    proposeDelete: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteKeyHandler,
        {
          provide: RaftIntegrationService,
          useValue: mockRaftIntegrationService,
        },
      ],
    }).compile();

    handler = module.get<DeleteKeyHandler>(DeleteKeyHandler);
    raftIntegrationService = module.get<RaftIntegrationService>(RaftIntegrationService);

    mockRaftIntegrationService.proposeDelete.mockClear();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  describe('execute', () => {
    it('should call raftIntegrationService.proposeDelete with the correct key', async () => {
      const command = new DeleteKeyCommand('testKeyToDelete');
      mockRaftIntegrationService.proposeDelete.mockResolvedValue(undefined as any);

      await handler.execute(command);

      expect(raftIntegrationService.proposeDelete).toHaveBeenCalledTimes(1);
      expect(raftIntegrationService.proposeDelete).toHaveBeenCalledWith(command.key);
    });

    it('should propagate errors from raftIntegrationService.proposeDelete', async () => {
      const command = new DeleteKeyCommand('testKeyToDelete');
      const expectedError = new Error('Raft proposal for delete failed');
      mockRaftIntegrationService.proposeDelete.mockRejectedValue(expectedError);

      await expect(handler.execute(command)).rejects.toThrow(expectedError);
    });
  });
});
