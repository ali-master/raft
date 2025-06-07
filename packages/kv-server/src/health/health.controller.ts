import { Controller, Get, Logger, Res } from '@nestjs/common';
import { HealthcheckService, HealthStatus } from './health.service';
import { FastifyReply } from 'fastify'; // Assuming Fastify

@Controller('health')
export class HealthcheckController {
  private readonly logger = new Logger(HealthcheckController.name);

  constructor(private readonly healthcheckService: HealthcheckService) {}

  @Get()
  async checkHealth(@Res() reply: FastifyReply): Promise<void> {
    this.logger.debug('Received health check request'); // Changed to debug for less noise
    const healthStatus: HealthStatus = await this.healthcheckService.getHealth();

    const httpStatusCode = healthStatus.overallStatus === 'HEALTHY' ? 200 : 503; // 503 Service Unavailable

    // Ensure headers are set before sending reply if not already handled by Fastify
    reply.header('Content-Type', 'application/json');
    reply.status(httpStatusCode).send(healthStatus);
  }

  // Optional: A more specific liveness/readiness endpoint for Kubernetes
  @Get('live')
  async live(@Res() reply: FastifyReply): Promise<void> {
    this.logger.debug('Received liveness check');
    // Liveness might just check if the process is running and Raft node is initialized
    const raftStatus = this.healthcheckService.raftIntegrationService.getRaftNodeStatus();
    if (raftStatus && raftStatus.status !== 'UNINITIALIZED' && raftStatus.nodeId !== 'N/A') {
      reply.status(200).send({ status: 'UP', nodeId: raftStatus.nodeId });
    } else {
      reply.status(503).send({ status: 'DOWN', reason: 'Raft node not initialized' });
    }
  }

  @Get('ready')
  async ready(@Res() reply: FastifyReply): Promise<void> {
    this.logger.debug('Received readiness check');
    // Readiness should check if the node is part of a quorum and ready to serve requests
    const healthStatus: HealthStatus = await this.healthcheckService.getHealth();
    const httpStatusCode = healthStatus.overallStatus === 'HEALTHY' && healthStatus.details.raft?.hasQuorum ? 200 : 503;

    reply.header('Content-Type', 'application/json');
    reply.status(httpStatusCode).send({
      status: httpStatusCode === 200 ? 'READY' : 'NOT_READY',
      details: healthStatus.details,
    });
  }
}
