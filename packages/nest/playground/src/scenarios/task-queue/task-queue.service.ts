import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { EventBusService } from "@/shared/services/event-bus.service";
import { MetricsService } from "@/shared/services/metrics.service";
import { LoggerService } from "@/shared/services/logger.service";

export enum TaskStatus {
  PENDING = "PENDING",
  ASSIGNED = "ASSIGNED",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface Task {
  id: string;
  type: string;
  payload: any;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  retries: number;
  maxRetries: number;
  result?: any;
}

export interface TaskOperation {
  type:
    | "CREATE"
    | "ASSIGN"
    | "UPDATE_STATUS"
    | "COMPLETE"
    | "FAIL"
    | "CANCEL"
    | "CLEANUP";
  taskId?: string;
  task?: Partial<Task>;
  workerId?: string;
  status?: TaskStatus;
  result?: any;
  error?: string;
  timestamp: number;
}

@Injectable()
export class TaskQueueService {
  private tasks = new Map<string, Task>();
  private tasksByStatus = new Map<TaskStatus, Set<string>>();
  private tasksByWorker = new Map<string, Set<string>>();
  private readonly nodeId: string;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly raftService: RaftService,
    private readonly eventBus: EventBusService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
    this.initializeStatusMaps();
    this.startCleanupWorker();
  }

  private initializeStatusMaps() {
    Object.values(TaskStatus).forEach((status) => {
      this.tasksByStatus.set(status, new Set());
    });
  }

  async createTask(
    type: string,
    payload: any,
    priority: TaskPriority = TaskPriority.NORMAL,
    maxRetries: number = 3,
  ): Promise<Task> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can create tasks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const task: Task = {
      id: this.generateTaskId(),
      type,
      payload,
      priority,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retries: 0,
      maxRetries,
    };

    const operation: TaskOperation = {
      type: "CREATE",
      task,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Task created: ${task.id} (${type})`, "TaskQueue");

    return task;
  }

  async assignNextTask(workerId: string): Promise<Task | null> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can assign tasks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    // Find highest priority pending task
    const pendingTask = this.findNextPendingTask();
    if (!pendingTask) {
      return null;
    }

    const operation: TaskOperation = {
      type: "ASSIGN",
      taskId: pendingTask.id,
      workerId,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(
      `Task ${pendingTask.id} assigned to ${workerId}`,
      "TaskQueue",
    );

    return pendingTask;
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    workerId: string,
  ): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can update tasks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    if (task.assignedTo !== workerId) {
      throw new BadRequestException(
        `Task ${taskId} is not assigned to ${workerId}`,
      );
    }

    const operation: TaskOperation = {
      type: "UPDATE_STATUS",
      taskId,
      status,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
  }

  async completeTask(
    taskId: string,
    workerId: string,
    result: any,
  ): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can complete tasks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: TaskOperation = {
      type: "COMPLETE",
      taskId,
      workerId,
      result,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
  }

  async failTask(
    taskId: string,
    workerId: string,
    error: string,
  ): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can fail tasks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: TaskOperation = {
      type: "FAIL",
      taskId,
      workerId,
      error,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
  }

  async cancelTask(taskId: string): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can cancel tasks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: TaskOperation = {
      type: "CANCEL",
      taskId,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    const taskIds = this.tasksByStatus.get(status) || new Set();
    return Array.from(taskIds)
      .map((id) => this.tasks.get(id))
      .filter((task): task is Task => task !== undefined);
  }

  getTasksByWorker(workerId: string): Task[] {
    const taskIds = this.tasksByWorker.get(workerId) || new Set();
    return Array.from(taskIds)
      .map((id) => this.tasks.get(id))
      .filter((task): task is Task => task !== undefined);
  }

  async getQueueStats() {
    const stats: any = {
      nodeId: this.nodeId,
      isLeader: this.raftService.isLeader(),
      totalTasks: this.tasks.size,
      tasksByStatus: {},
      tasksByType: {},
      workerStats: {},
    };

    // Tasks by status
    for (const [status, taskIds] of this.tasksByStatus.entries()) {
      stats.tasksByStatus[status] = taskIds.size;
    }

    // Tasks by type
    const tasksByType = new Map<string, number>();
    for (const task of this.tasks.values()) {
      tasksByType.set(task.type, (tasksByType.get(task.type) || 0) + 1);
    }
    stats.tasksByType = Object.fromEntries(tasksByType);

    // Worker stats
    for (const [workerId, taskIds] of this.tasksByWorker.entries()) {
      const tasks = Array.from(taskIds)
        .map((id) => this.tasks.get(id))
        .filter((task): task is Task => task !== undefined);

      stats.workerStats[workerId] = {
        assignedTasks: tasks.length,
        processingTasks: tasks.filter((t) => t.status === TaskStatus.PROCESSING)
          .length,
        completedTasks: tasks.filter((t) => t.status === TaskStatus.COMPLETED)
          .length,
        failedTasks: tasks.filter((t) => t.status === TaskStatus.FAILED).length,
      };
    }

    return stats;
  }

  // Internal method called by event handler
  applyOperation(operation: TaskOperation) {
    switch (operation.type) {
      case "CREATE":
        this.applyCreate(operation);
        break;
      case "ASSIGN":
        this.applyAssign(operation);
        break;
      case "UPDATE_STATUS":
        this.applyUpdateStatus(operation);
        break;
      case "COMPLETE":
        this.applyComplete(operation);
        break;
      case "FAIL":
        this.applyFail(operation);
        break;
      case "CANCEL":
        this.applyCancel(operation);
        break;
      case "CLEANUP":
        this.applyCleanup(operation);
        break;
    }
  }

  private applyCreate(operation: TaskOperation) {
    const task = operation.task!;
    this.tasks.set(task.id, task);
    this.tasksByStatus.get(TaskStatus.PENDING)?.add(task.id);

    this.eventBus.emitTaskEvent("created", task.id, {
      type: task.type,
      priority: task.priority,
    });
    this.metrics.incrementCounter("tasks_created_total", {
      node: this.nodeId,
      type: task.type,
    });
  }

  private applyAssign(operation: TaskOperation) {
    const task = this.tasks.get(operation.taskId!);
    if (!task) return;

    // Update status tracking
    this.tasksByStatus.get(task.status)?.delete(task.id);
    task.status = TaskStatus.ASSIGNED;
    task.assignedTo = operation.workerId;
    task.updatedAt = new Date();
    this.tasksByStatus.get(TaskStatus.ASSIGNED)?.add(task.id);

    // Update worker tracking
    if (!this.tasksByWorker.has(operation.workerId!)) {
      this.tasksByWorker.set(operation.workerId!, new Set());
    }
    this.tasksByWorker.get(operation.workerId!)?.add(task.id);

    this.eventBus.emitTaskEvent("assigned", task.id, {
      workerId: operation.workerId,
    });
  }

  private applyUpdateStatus(operation: TaskOperation) {
    const task = this.tasks.get(operation.taskId!);
    if (!task) return;

    this.tasksByStatus.get(task.status)?.delete(task.id);
    task.status = operation.status!;
    task.updatedAt = new Date();

    if (operation.status === TaskStatus.PROCESSING) {
      task.startedAt = new Date();
    }

    this.tasksByStatus.get(operation.status!)?.add(task.id);
    this.eventBus.emitTaskEvent("status_changed", task.id, {
      status: operation.status,
    });
  }

  private applyComplete(operation: TaskOperation) {
    const task = this.tasks.get(operation.taskId!);
    if (!task) return;

    this.tasksByStatus.get(task.status)?.delete(task.id);
    task.status = TaskStatus.COMPLETED;
    task.result = operation.result;
    task.completedAt = new Date();
    task.updatedAt = new Date();
    this.tasksByStatus.get(TaskStatus.COMPLETED)?.add(task.id);

    this.tasksByWorker.get(task.assignedTo!)?.delete(task.id);
    this.eventBus.emitTaskEvent("completed", task.id, {
      workerId: task.assignedTo,
    });
    this.metrics.incrementCounter("tasks_processed_total", {
      node: this.nodeId,
      status: "completed",
      type: task.type,
    });
  }

  private applyFail(operation: TaskOperation) {
    const task = this.tasks.get(operation.taskId!);
    if (!task) return;

    task.retries++;

    if (task.retries < task.maxRetries) {
      // Retry: move back to pending
      this.tasksByStatus.get(task.status)?.delete(task.id);
      task.status = TaskStatus.PENDING;
      task.assignedTo = undefined;
      task.error = operation.error;
      task.updatedAt = new Date();
      this.tasksByStatus.get(TaskStatus.PENDING)?.add(task.id);

      this.tasksByWorker.get(operation.workerId!)?.delete(task.id);
      this.eventBus.emitTaskEvent("retrying", task.id, {
        retries: task.retries,
      });
    } else {
      // Final failure
      this.tasksByStatus.get(task.status)?.delete(task.id);
      task.status = TaskStatus.FAILED;
      task.error = operation.error;
      task.failedAt = new Date();
      task.updatedAt = new Date();
      this.tasksByStatus.get(TaskStatus.FAILED)?.add(task.id);

      this.tasksByWorker.get(task.assignedTo!)?.delete(task.id);
      this.eventBus.emitTaskEvent("failed", task.id, {
        error: operation.error,
      });
      this.metrics.incrementCounter("tasks_processed_total", {
        node: this.nodeId,
        status: "failed",
        type: task.type,
      });
    }
  }

  private applyCancel(operation: TaskOperation) {
    const task = this.tasks.get(operation.taskId!);
    if (!task) return;

    this.tasksByStatus.get(task.status)?.delete(task.id);
    task.status = TaskStatus.CANCELLED;
    task.updatedAt = new Date();
    this.tasksByStatus.get(TaskStatus.CANCELLED)?.add(task.id);

    if (task.assignedTo) {
      this.tasksByWorker.get(task.assignedTo)?.delete(task.id);
    }

    this.eventBus.emitTaskEvent("cancelled", task.id);
  }

  private applyCleanup(operation: TaskOperation) {
    const task = this.tasks.get(operation.taskId!);
    if (!task) return;

    this.tasksByStatus.get(task.status)?.delete(task.id);
    if (task.assignedTo) {
      this.tasksByWorker.get(task.assignedTo)?.delete(task.id);
    }
    this.tasks.delete(task.id);

    this.logger.debug(`Task ${task.id} cleaned up`, "TaskQueue");
  }

  private findNextPendingTask(): Task | null {
    const pendingIds = this.tasksByStatus.get(TaskStatus.PENDING) || new Set();

    let highestPriorityTask: Task | null = null;
    let highestPriority = -1;

    for (const taskId of pendingIds) {
      const task = this.tasks.get(taskId);
      if (task && task.priority > highestPriority) {
        highestPriority = task.priority;
        highestPriorityTask = task;
      }
    }

    return highestPriorityTask;
  }

  private generateTaskId(): string {
    return `task-${this.nodeId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupWorker() {
    this.cleanupInterval = setInterval(() => {
      if (!this.raftService.isLeader()) return;

      const now = Date.now();
      const tasksToCleanup: string[] = [];

      // Find completed/failed/cancelled tasks older than 1 hour
      const statesToCleanup = [
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
      ];

      for (const status of statesToCleanup) {
        const taskIds = this.tasksByStatus.get(status) || new Set();

        for (const taskId of taskIds) {
          const task = this.tasks.get(taskId);
          if (task && now - task.updatedAt.getTime() > 3600000) {
            // 1 hour
            tasksToCleanup.push(taskId);
          }
        }
      }

      // Cleanup old tasks
      tasksToCleanup.forEach((taskId) => {
        this.raftService.propose({
          type: "CLEANUP",
          taskId,
          timestamp: Date.now(),
        });
      });

      if (tasksToCleanup.length > 0) {
        this.logger.log(
          `Cleaning up ${tasksToCleanup.length} old tasks`,
          "TaskQueue",
        );
      }
    }, 60000); // Run every minute
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
