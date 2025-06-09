import { Injectable } from '@nestjs/common';
import type { IQuery, ICommand } from '@nestjs/cqrs';

export abstract class BaseCommand implements ICommand {
  abstract readonly type: string;
}

export abstract class BaseQuery implements IQuery {
  abstract readonly type: string;
}

@Injectable()
export abstract class BaseCommandHandler<T extends BaseCommand> {
  abstract execute(command: T): Promise<void>;
}

@Injectable()
export abstract class BaseQueryHandler<T extends BaseQuery, R = any> {
  abstract execute(query: T): Promise<R>;
}
