import { Post, Param, Get, Delete, Controller, Body } from "@nestjs/common";
import { ApiTags, ApiResponse, ApiOperation } from "@nestjs/swagger";
import type { KVStoreService } from "./kv-store.service";

@ApiTags("KV Store")
@Controller("kv")
export class KVStoreController {
  constructor(private readonly kvStoreService: KVStoreService) {}

  @Post(":key")
  @ApiOperation({ summary: "Set a value for a key" })
  @ApiResponse({ status: 201, description: "Value set successfully" })
  async setValue(
    @Param("key") key: string,
    @Body("value") value: string,
  ): Promise<void> {
    await this.kvStoreService.setValue(key, value);
  }

  @Get(":key")
  @ApiOperation({ summary: "Get a value by key" })
  @ApiResponse({ status: 200, description: "Value retrieved successfully" })
  async getValue(@Param("key") key: string): Promise<string | null> {
    return this.kvStoreService.getValue(key);
  }

  @Delete(":key")
  @ApiOperation({ summary: "Delete a value by key" })
  @ApiResponse({ status: 200, description: "Value deleted successfully" })
  async deleteValue(@Param("key") key: string): Promise<void> {
    await this.kvStoreService.deleteValue(key);
  }

  @Get()
  @ApiOperation({ summary: "List all keys" })
  @ApiResponse({ status: 200, description: "Keys retrieved successfully" })
  async listKeys(): Promise<string[]> {
    return this.kvStoreService.listKeys();
  }
}
