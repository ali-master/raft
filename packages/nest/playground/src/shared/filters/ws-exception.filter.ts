import { Catch, ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import { Socket } from "socket.io";

@Catch(WsException)
export class WsExceptionFilter implements ExceptionFilter {
  catch(exception: WsException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const error = exception.getError();

    const details = error instanceof Object ? { ...error } : { message: error };

    client.emit("error", {
      status: "error",
      timestamp: new Date().toISOString(),
      ...details,
    });
  }
}
