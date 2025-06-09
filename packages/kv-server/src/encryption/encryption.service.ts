import { Injectable } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import CryptoJS from "crypto-js";
import { ErrorHandler, ConfigHelper } from "../shared";

@Injectable()
export class EncryptionService {
  private readonly encryptionKey: string;

  constructor(private readonly configService: ConfigService) {
    this.encryptionKey = ConfigHelper.getEncryptionKey(this.configService);
  }

  encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
  }

  decrypt(encryptedData: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  async isHealthy(): Promise<boolean> {
    return ErrorHandler.safeExecuteWithBoolean(async () => {
      const testData = "test-data";
      const encrypted = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted);
      if (decrypted !== testData) {
        throw new Error("Encryption/decryption test failed");
      }
    });
  }
}
