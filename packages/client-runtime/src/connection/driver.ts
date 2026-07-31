import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as ScopeRuntime from "effect/Scope";

import {
  type BearerConnectionEndpoint,
  bearerConnectionProfileEndpoints,
  type ConnectionCatalogEntry,
} from "./catalog.ts";
import type {
  ConnectionAttemptError,
  ConnectionAttemptStage,
  PreparedConnection,
} from "./model.ts";
import { ConnectionTransientError } from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";
import * as RpcSession from "../rpc/session.ts";

export const CONNECTION_ENDPOINT_TIMEOUT_MS = 15_000;

export type ConnectionDriverProgress =
  | {
      readonly stage: "preparing";
    }
  | {
      readonly stage: Exclude<ConnectionAttemptStage, "preparing">;
      readonly prepared: PreparedConnection;
    };

export interface EnvironmentConnectionLease {
  readonly prepared: PreparedConnection;
  readonly session: RpcSession.RpcSession;
}

function connectionEndpointCandidates(
  entry: ConnectionCatalogEntry,
): ReadonlyArray<BearerConnectionEndpoint | undefined> {
  const profile = Option.getOrNull(entry.profile);
  return profile?._tag === "BearerConnectionProfile"
    ? bearerConnectionProfileEndpoints(profile)
    : [undefined];
}

function shouldTryNextEndpoint(error: ConnectionAttemptError): boolean {
  if (error._tag !== "ConnectionTransientError") return false;
  switch (error.reason) {
    case "network":
    case "timeout":
    case "transport":
    case "endpoint-unavailable":
      return true;
    case "relay-unavailable":
    case "remote-unavailable":
      return false;
  }
}

export class ConnectionDriver extends Context.Service<
  ConnectionDriver,
  {
    readonly connect: (
      entry: ConnectionCatalogEntry,
      reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
    ) => Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope>;
  }
>()("@t3tools/client-runtime/connection/driver/ConnectionDriver") {}

export const make = Effect.gen(function* () {
  const resolver = yield* ConnectionResolver.ConnectionResolver;
  const sessions = yield* RpcSession.RpcSessionFactory;

  const connect = Effect.fn("ConnectionDriver.connect")(function* (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
  ) {
    const target = entry.target;
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": target.environmentId,
      "connection.target.kind": target._tag,
    });
    const parentScope = yield* Effect.scope;
    let lastFailure: ConnectionAttemptError | null = null;

    for (const endpoint of connectionEndpointCandidates(entry)) {
      const attemptScope = yield* ScopeRuntime.fork(parentScope, "sequential");
      const result = yield* Effect.gen(function* () {
        yield* reportProgress({ stage: "preparing" });
        const prepared = yield* resolver.prepare(entry, endpoint);
        yield* reportProgress({ stage: "opening", prepared });
        const session = yield* sessions.connect(prepared);
        yield* reportProgress({ stage: "synchronizing", prepared });
        yield* session.ready;
        return { prepared, session } satisfies EnvironmentConnectionLease;
      }).pipe(
        Effect.provideService(ScopeRuntime.Scope, attemptScope),
        Effect.timeoutOrElse({
          duration: CONNECTION_ENDPOINT_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              new ConnectionTransientError({
                reason: "timeout",
                detail: `${target.label} endpoint did not respond during connection setup.`,
              }),
            ),
        }),
        Effect.result,
      );

      if (result._tag === "Success") {
        return result.success;
      }

      yield* ScopeRuntime.close(attemptScope, Exit.void).pipe(Effect.ignore);
      lastFailure = result.failure;
      if (!shouldTryNextEndpoint(lastFailure)) {
        return yield* lastFailure;
      }
    }

    if (lastFailure !== null) {
      return yield* lastFailure;
    }
    return yield* Effect.die(
      new Error("Connection attempt completed without an endpoint candidate."),
    );
  });

  return ConnectionDriver.of({ connect });
});

export const layer = Layer.effect(ConnectionDriver, make);
