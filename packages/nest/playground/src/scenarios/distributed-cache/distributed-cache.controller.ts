import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { DistributedCacheService } from "./distributed-cache.service";

class SetCacheDto {
  value: any;
  ttl?: number;
}

@ApiTags("cache")
@Controller("cache")
export class DistributedCacheController {
  constructor(private readonly cacheService: DistributedCacheService) {}

  @Get("stats")
  @ApiOperation({ summary: "Get cache statistics" })
  @ApiResponse({ status: 200, description: "Cache statistics" })
  async getStats() {
    return this.cacheService.stats();
  }

  @Get("keys")
  @ApiOperation({ summary: "List all cache keys" })
  @ApiQuery({
    name: "pattern",
    required: false,
    description: "Filter pattern (e.g., user:*)",
  })
  @ApiResponse({ status: 200, description: "Array of cache keys" })
  async getKeys(@Query("pattern") pattern?: string) {
    return this.cacheService.keys(pattern);
  }

  @Get("size")
  @ApiOperation({ summary: "Get cache size" })
  @ApiResponse({ status: 200, description: "Number of entries in cache" })
  async getSize() {
    const size = await this.cacheService.size();
    return { size };
  }

  @Get(":key")
  @ApiOperation({ summary: "Get value by key" })
  @ApiResponse({ status: 200, description: "Cache value" })
  @ApiResponse({ status: 404, description: "Key not found" })
  async get(@Param("key") key: string) {
    const value = await this.cacheService.get(key);
    if (value === null) {
      return { found: false, value: null };
    }
    return { found: true, value };
  }

  @Post(":key")
  @ApiOperation({ summary: "Set cache value" })
  @ApiBody({ type: SetCacheDto })
  @ApiResponse({ status: 201, description: "Value set successfully" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async set(@Param("key") key: string, @Body() body: SetCacheDto) {
    await this.cacheService.set(key, body.value, body.ttl);
    return { success: true, key };
  }

  @Delete("all")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Clear all cache entries" })
  @ApiResponse({ status: 204, description: "Cache cleared" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async clear() {
    await this.cacheService.clear();
  }

  @Delete(":key")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete cache entry" })
  @ApiResponse({ status: 204, description: "Entry deleted" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async delete(@Param("key") key: string) {
    await this.cacheService.delete(key);
  }
}
