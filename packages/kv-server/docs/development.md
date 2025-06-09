# Development Guide

## Overview

This guide provides comprehensive information for developers working on the Raft KV Server project. It covers the development environment setup, coding standards, testing procedures, and contribution guidelines.

## Development Environment Setup

### Prerequisites

- Node.js >= 18.12.0
- pnpm >= 10.11.1
- Docker and Docker Compose
- Git

### Initial Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/your-org/raft-kv-server.git
   cd raft-kv-server
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Environment Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

4. **Start Development Server**
   ```bash
   pnpm dev
   ```

## Project Structure

```
kv-server/
├── src/
│   ├── commands/           # Command handlers
│   ├── queries/           # Query handlers
│   ├── events/            # Event handlers
│   ├── controllers/       # API controllers
│   ├── services/          # Business logic
│   ├── models/            # Data models
│   ├── interfaces/        # TypeScript interfaces
│   ├── utils/             # Utility functions
│   └── main.ts            # Application entry point
├── test/                  # Test files
├── docs/                  # Documentation
└── config/               # Configuration files
```

## Coding Standards

### TypeScript Guidelines

1. **Type Safety**
   - Use strict type checking
   - Avoid `any` type
   - Define interfaces for all data structures

2. **Naming Conventions**
   ```typescript
   // Interfaces
   interface IUserService {
     // ...
   }

   // Classes
   class UserController {
     // ...
   }

   // Constants
   const MAX_RETRY_COUNT = 3;

   // Functions
   function calculateTotal(): number {
     // ...
   }
   ```

3. **Code Organization**
   - One class/interface per file
   - Group related functionality
   - Use barrel exports

### Error Handling

```typescript
try {
  // Operation
} catch (error) {
  if (error instanceof CustomError) {
    // Handle specific error
  } else {
    // Handle generic error
  }
}
```

### Logging

```typescript
import { Logger } from '@nestjs/common';

export class MyService {
  private readonly logger = new Logger(MyService.name);

  async someMethod() {
    this.logger.debug('Debug message');
    this.logger.log('Info message');
    this.logger.warn('Warning message');
    this.logger.error('Error message', error.stack);
  }
}
```

## Testing

### Unit Testing

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MyService } from './my.service';

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MyService],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should perform specific operation', async () => {
    const result = await service.someMethod();
    expect(result).toBeDefined();
  });
});
```

### Integration Testing

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test src/specific.test.ts

# Run tests with coverage
pnpm test:cov
```

## CQRS Pattern Implementation

### Commands

```typescript
// commands/set-value.command.ts
export class SetValueCommand {
  constructor(
    public readonly key: string,
    public readonly value: string,
  ) {}
}

// commands/handlers/set-value.handler.ts
@CommandHandler(SetValueCommand)
export class SetValueHandler implements ICommandHandler<SetValueCommand> {
  constructor(private readonly store: Store) {}

  async execute(command: SetValueCommand) {
    await this.store.set(command.key, command.value);
  }
}
```

### Queries

```typescript
// queries/get-value.query.ts
export class GetValueQuery {
  constructor(public readonly key: string) {}
}

// queries/handlers/get-value.handler.ts
@QueryHandler(GetValueQuery)
export class GetValueHandler implements IQueryHandler<GetValueQuery> {
  constructor(private readonly store: Store) {}

  async execute(query: GetValueQuery) {
    return this.store.get(query.key);
  }
}
```

### Events

```typescript
// events/value-set.event.ts
export class ValueSetEvent {
  constructor(
    public readonly key: string,
    public readonly value: string,
  ) {}
}

// events/handlers/value-set.handler.ts
@EventsHandler(ValueSetEvent)
export class ValueSetHandler implements IEventHandler<ValueSetEvent> {
  constructor(private readonly logger: Logger) {}

  handle(event: ValueSetEvent) {
    this.logger.log(`Value set for key: ${event.key}`);
  }
}
```

## API Development

### Controller Example

```typescript
@Controller('kv')
export class KvController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async setValue(@Body() dto: SetValueDto) {
    return this.commandBus.execute(
      new SetValueCommand(dto.key, dto.value),
    );
  }

  @Get(':key')
  async getValue(@Param('key') key: string) {
    return this.queryBus.execute(
      new GetValueQuery(key),
    );
  }
}
```

### DTOs

```typescript
export class SetValueDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}
```

## Performance Optimization

### 1. Caching

```typescript
@Injectable()
export class CacheService {
  private cache = new Map<string, any>();

  async get<T>(key: string): Promise<T | null> {
    return this.cache.get(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
  }
}
```

### 2. Connection Pooling

```typescript
@Injectable()
export class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
}
```

## Debugging

### 1. VS Code Configuration

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Program",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/src/main.ts"
    }
  ]
}
```

### 2. Logging Configuration

```typescript
// config/logger.config.ts
export const loggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
};
```

## Git Workflow

### Branch Naming

- `feature/` - New features
- `bugfix/` - Bug fixes
- `hotfix/` - Urgent fixes
- `release/` - Release preparation

### Commit Messages

```
type(scope): subject

body

footer
```

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Testing
- chore: Maintenance

## Code Review Process

1. **Pull Request Template**
   ```markdown
   ## Description
   [Description of changes]

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   - [ ] Unit tests added/updated
   - [ ] Integration tests added/updated
   - [ ] Manual testing completed

   ## Documentation
   - [ ] README updated
   - [ ] API documentation updated
   - [ ] Code comments added/updated
   ```

2. **Review Checklist**
   - Code style compliance
   - Test coverage
   - Documentation updates
   - Performance impact
   - Security considerations

## Release Process

1. **Version Bumping**
   ```bash
   pnpm version patch  # 0.0.x
   pnpm version minor  # 0.x.0
   pnpm version major  # x.0.0
   ```

2. **Changelog Generation**
   ```bash
   pnpm changelog
   ```

3. **Release Steps**
   - Update version
   - Generate changelog
   - Create release branch
   - Run tests
   - Build artifacts
   - Create tag
   - Deploy

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Check Node.js version
   - Clear cache: `pnpm store prune`
   - Remove node_modules: `rm -rf node_modules`

2. **Test Failures**
   - Check test environment
   - Verify test data
   - Check for race conditions

3. **Runtime Errors**
   - Check logs
   - Verify configuration
   - Check dependencies

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Raft Protocol Paper](https://raft.github.io/raft.pdf)
- [Docker Documentation](https://docs.docker.com/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
