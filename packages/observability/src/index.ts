import type { NoxEnvironment } from "@nox-os/contracts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: NoxEnvironment;
  sourceSha: string;
  requestId?: string;
  correlationId?: string;
  moduleId?: string;
  message: string;
  details?: Record<string, unknown>;
};

export type LogSink = (event: LogEvent) => void;

const forbiddenDetailNames =
  /(authorization|cookie|password|secret|token|database_url|service_role)/i;

export function redactDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      forbiddenDetailNames.test(key) ? "[REDACTED]" : value
    ])
  );
}

export function createLogger(
  identity: Pick<LogEvent, "service" | "environment" | "sourceSha">,
  sink: LogSink = (event) => console.log(JSON.stringify(event))
) {
  return {
    log(
      level: LogLevel,
      message: string,
      context: Omit<
        LogEvent,
        "timestamp" | "level" | "service" | "environment" | "sourceSha" | "message"
      > = {}
    ): void {
      sink({
        timestamp: new Date().toISOString(),
        level,
        service: identity.service,
        environment: identity.environment,
        sourceSha: identity.sourceSha,
        message,
        ...context,
        details: redactDetails(context.details)
      });
    }
  };
}
