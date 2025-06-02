import {
  Controller,
  Get,
  Post,
  Put,
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
import {
  TaskQueueService,
  TaskStatus,
  TaskPriority,
} from "./task-queue.service";

class CreateTaskDto {
  type: string;
  payload: any;
  priority?: TaskPriority;
  maxRetries?: number;
}

class UpdateTaskStatusDto {
  status: TaskStatus;
  workerId: string;
}

class CompleteTaskDto {
  workerId: string;
  result: any;
}

class FailTaskDto {
  workerId: string;
  error: string;
}

@ApiTags("task-queue")
@Controller("tasks")
export class TaskQueueController {
  constructor(private readonly taskQueueService: TaskQueueService) {}

  @Get("stats")
  @ApiOperation({ summary: "Get task queue statistics" })
  @ApiResponse({ status: 200, description: "Queue statistics" })
  async getStats() {
    return this.taskQueueService.getQueueStats();
  }

  @Get("status/:status")
  @ApiOperation({ summary: "Get tasks by status" })
  @ApiResponse({ status: 200, description: "Array of tasks" })
  async getTasksByStatus(@Param("status") status: TaskStatus) {
    return this.taskQueueService.getTasksByStatus(status);
  }

  @Get("worker/:workerId")
  @ApiOperation({ summary: "Get tasks assigned to worker" })
  @ApiResponse({ status: 200, description: "Array of tasks" })
  async getTasksByWorker(@Param("workerId") workerId: string) {
    return this.taskQueueService.getTasksByWorker(workerId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get task by ID" })
  @ApiResponse({ status: 200, description: "Task details" })
  @ApiResponse({ status: 404, description: "Task not found" })
  async getTask(@Param("id") id: string) {
    const task = this.taskQueueService.getTask(id);
    if (!task) {
      return { found: false, task: null };
    }
    return { found: true, task };
  }

  @Post()
  @ApiOperation({ summary: "Create a new task" })
  @ApiBody({ type: CreateTaskDto })
  @ApiResponse({ status: 201, description: "Task created" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async createTask(@Body() dto: CreateTaskDto) {
    const task = await this.taskQueueService.createTask(
      dto.type,
      dto.payload,
      dto.priority,
      dto.maxRetries,
    );
    return task;
  }

  @Post("assign/:workerId")
  @ApiOperation({ summary: "Assign next available task to worker" })
  @ApiResponse({ status: 200, description: "Assigned task or null" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async assignTask(@Param("workerId") workerId: string) {
    const task = await this.taskQueueService.assignNextTask(workerId);
    return { assigned: !!task, task };
  }

  @Put(":id/status")
  @ApiOperation({ summary: "Update task status" })
  @ApiBody({ type: UpdateTaskStatusDto })
  @ApiResponse({ status: 200, description: "Status updated" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 404, description: "Task not found" })
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    await this.taskQueueService.updateTaskStatus(id, dto.status, dto.workerId);
    return { success: true };
  }

  @Post(":id/complete")
  @ApiOperation({ summary: "Mark task as completed" })
  @ApiBody({ type: CompleteTaskDto })
  @ApiResponse({ status: 200, description: "Task completed" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  async completeTask(@Param("id") id: string, @Body() dto: CompleteTaskDto) {
    await this.taskQueueService.completeTask(id, dto.workerId, dto.result);
    return { success: true };
  }

  @Post(":id/fail")
  @ApiOperation({ summary: "Mark task as failed" })
  @ApiBody({ type: FailTaskDto })
  @ApiResponse({ status: 200, description: "Task failed" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  async failTask(@Param("id") id: string, @Body() dto: FailTaskDto) {
    await this.taskQueueService.failTask(id, dto.workerId, dto.error);
    return { success: true };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Cancel task" })
  @ApiResponse({ status: 204, description: "Task cancelled" })
  @ApiResponse({ status: 400, description: "Not the leader node" })
  async cancelTask(@Param("id") id: string) {
    await this.taskQueueService.cancelTask(id);
  }
}
