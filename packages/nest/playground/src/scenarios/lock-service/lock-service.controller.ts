import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { LockService, LockRequest } from "./lock-service.service";

class AcquireLockDto {
  owner: string;
  ttl?: number;
  metadata?: any;
}

class ReleaseLockDto {
  owner: string;
}

class RenewLockDto {
  owner: string;
  ttl?: number;
}

@ApiTags("locks")
@Controller("locks")
export class LockServiceController {
  constructor(private readonly lockService: LockService) {}

  @Get("stats")
  @ApiOperation({ summary: "Get lock service statistics" })
  @ApiResponse({ status: 200, description: "Lock statistics" })
  async getStats() {
    return this.lockService.getStats();
  }

  @Get()
  @ApiOperation({ summary: "List all active locks" })
  @ApiResponse({ status: 200, description: "Array of active locks" })
  async getAllLocks() {
    return this.lockService.getAllLocks();
  }

  @Get("owner/:owner")
  @ApiOperation({ summary: "Get locks by owner" })
  @ApiResponse({
    status: 200,
    description: "Array of locks owned by specified owner",
  })
  async getLocksByOwner(@Param("owner") owner: string) {
    return this.lockService.getLocksByOwner(owner);
  }

  @Get(":resource")
  @ApiOperation({ summary: "Get lock information" })
  @ApiResponse({ status: 200, description: "Lock information" })
  @ApiResponse({ status: 404, description: "Lock not found or expired" })
  async getLock(@Param("resource") resource: string) {
    const lock = this.lockService.getLock(resource);
    if (!lock) {
      return { found: false, lock: null };
    }
    return { found: true, lock };
  }

  @Post(":resource")
  @ApiOperation({ summary: "Acquire a lock" })
  @ApiBody({ type: AcquireLockDto })
  @ApiResponse({ status: 201, description: "Lock acquired" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  @ApiResponse({ status: 409, description: "Lock already held" })
  async acquireLock(
    @Param("resource") resource: string,
    @Body() dto: AcquireLockDto,
  ) {
    const request: LockRequest = {
      resource,
      owner: dto.owner,
      ttl: dto.ttl,
      metadata: dto.metadata,
    };

    const lock = await this.lockService.acquireLock(request);
    return lock;
  }

  @Put(":resource/renew")
  @ApiOperation({ summary: "Renew a lock" })
  @ApiBody({ type: RenewLockDto })
  @ApiResponse({ status: 200, description: "Lock renewed" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 404, description: "Lock not found" })
  async renewLock(
    @Param("resource") resource: string,
    @Body() dto: RenewLockDto,
  ) {
    const lock = await this.lockService.renewLock(resource, dto.owner, dto.ttl);
    return lock;
  }

  @Delete(":resource")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Release a lock" })
  @ApiBody({ type: ReleaseLockDto })
  @ApiResponse({ status: 204, description: "Lock released" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 404, description: "Lock not found" })
  async releaseLock(
    @Param("resource") resource: string,
    @Body() dto: ReleaseLockDto,
  ) {
    await this.lockService.releaseLock(resource, dto.owner);
  }
}
