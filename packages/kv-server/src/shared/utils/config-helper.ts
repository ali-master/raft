import type { ConfigService } from '@nestjs/config';
import { NODE_DEFAULTS, ENV_KEYS } from '../config/constants';

export class ConfigHelper {
  static getNodeId(configService: ConfigService): string {
    return configService.get<string>(ENV_KEYS.RAFT_NODE_ID, NODE_DEFAULTS.NODE_ID);
  }

  static getClusterId(configService: ConfigService): string {
    return configService.get<string>(ENV_KEYS.RAFT_CLUSTER_ID, NODE_DEFAULTS.CLUSTER_ID);
  }

  static getEncryptionKey(configService: ConfigService): string {
    const key = configService.get<string>(ENV_KEYS.ENCRYPTION_KEY);
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    return key;
  }
}
