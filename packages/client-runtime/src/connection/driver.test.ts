import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import * as RpcSession from "../rpc/session.ts";
import { BearerConnectionProfile, type ConnectionCatalogEntry } from "./catalog.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  type PreparedConnection,
} from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const TARGET = new BearerConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Remote",
  connectionId: "bearer:environment-1",
});
const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: ENVIRONMENT_ID,
      label: TARGET.label,
      httpBaseUrl: "http://lan.example.test/",
      wsBaseUrl: "ws://lan.example.test/",
      endpoints: [
        {
          httpBaseUrl: "http://lan.example.test/",
          wsBaseUrl: "ws://lan.example.test/",
        },
        {
          httpBaseUrl: "https://public.example.test/",
          wsBaseUrl: "wss://public.example.test/",
        },
      ],
    }),
  ),
};

function prepared(httpBaseUrl: string, wsBaseUrl: string): PreparedConnection {
  return {
    environmentId: ENVIRONMENT_ID,
    label: TARGET.label,
    httpBaseUrl,
    socketUrl: new URL("/ws", wsBaseUrl).toString(),
    httpAuthorization: null,
    target: TARGET,
  };
}

function rpcSession(ready: RpcSession.RpcSession["ready"]): RpcSession.RpcSession {
  return {
    client: {} as RpcSession.RpcSession["client"],
    initialConfig: Effect.die("unused"),
    ready,
    probe: Effect.void,
    closed: Effect.never,
  };
}

describe("ConnectionDriver", () => {
  it.effect("times out one endpoint and prepares the next endpoint in the same attempt", () =>
    Effect.gen(function* () {
      const firstEndpointStarted = yield* Deferred.make<void>();
      const resolver = ConnectionResolver.ConnectionResolver.of({
        prepare: (_entry, endpoint) => {
          const selected = endpoint!;
          return selected.httpBaseUrl.includes("lan")
            ? Deferred.succeed(firstEndpointStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed(prepared(selected.httpBaseUrl, selected.wsBaseUrl));
        },
      });
      const sessions = RpcSession.RpcSessionFactory.of({
        connect: () => Effect.succeed(rpcSession(Effect.void)),
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
        Effect.provide(
          ConnectionDriver.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
                Layer.succeed(RpcSession.RpcSessionFactory, sessions),
              ),
            ),
          ),
        ),
      );

      const connection = yield* Effect.scoped(
        driver.connect(ENTRY, () => Effect.void).pipe(Effect.map((lease) => lease.prepared)),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(firstEndpointStarted);
      yield* TestClock.adjust("15 seconds");

      expect((yield* Fiber.join(connection)).httpBaseUrl).toBe("https://public.example.test/");
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("continues after an endpoint fails while opening the RPC session", () =>
    Effect.gen(function* () {
      const openedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
      const resolver = ConnectionResolver.ConnectionResolver.of({
        prepare: (_entry, endpoint) =>
          Effect.succeed(prepared(endpoint!.httpBaseUrl, endpoint!.wsBaseUrl)),
      });
      const sessions = RpcSession.RpcSessionFactory.of({
        connect: (connection) =>
          Ref.update(openedUrls, (values) => [...values, connection.httpBaseUrl]).pipe(
            Effect.andThen(
              connection.httpBaseUrl.includes("lan")
                ? Effect.fail(
                    new ConnectionTransientError({
                      reason: "transport",
                      detail: "LAN websocket failed to open.",
                    }),
                  )
                : Effect.succeed(rpcSession(Effect.void)),
            ),
          ),
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
        Effect.provide(
          ConnectionDriver.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
                Layer.succeed(RpcSession.RpcSessionFactory, sessions),
              ),
            ),
          ),
        ),
      );

      const connectedUrl = yield* Effect.scoped(
        driver
          .connect(ENTRY, () => Effect.void)
          .pipe(Effect.map((lease) => lease.prepared.httpBaseUrl)),
      );

      expect(connectedUrl).toBe("https://public.example.test/");
      expect(yield* Ref.get(openedUrls)).toEqual([
        "http://lan.example.test/",
        "https://public.example.test/",
      ]);
    }),
  );

  it.effect("releases a failed endpoint and connects the next endpoint in the same attempt", () =>
    Effect.gen(function* () {
      const preparedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
      const releasedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
      const progress = yield* Ref.make<ReadonlyArray<string>>([]);
      const resolver = ConnectionResolver.ConnectionResolver.of({
        prepare: (_entry, endpoint) => {
          const selected = endpoint!;
          return Ref.update(preparedUrls, (values) => [...values, selected.httpBaseUrl]).pipe(
            Effect.as(prepared(selected.httpBaseUrl, selected.wsBaseUrl)),
          );
        },
      });
      const sessions = RpcSession.RpcSessionFactory.of({
        connect: (connection) =>
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            yield* Scope.addFinalizer(
              scope,
              Ref.update(releasedUrls, (values) => [...values, connection.httpBaseUrl]),
            );
            return rpcSession(
              connection.httpBaseUrl.includes("lan")
                ? Effect.fail(
                    new ConnectionTransientError({
                      reason: "transport",
                      detail: "LAN endpoint unavailable.",
                    }),
                  )
                : Effect.void,
            );
          }),
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
        Effect.provide(
          ConnectionDriver.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
                Layer.succeed(RpcSession.RpcSessionFactory, sessions),
              ),
            ),
          ),
        ),
      );

      const connectedUrl = yield* Effect.scoped(
        driver
          .connect(ENTRY, (event) => Ref.update(progress, (values) => [...values, event.stage]))
          .pipe(Effect.map((lease) => lease.prepared.httpBaseUrl)),
      );

      expect(connectedUrl).toBe("https://public.example.test/");
      expect(yield* Ref.get(preparedUrls)).toEqual([
        "http://lan.example.test/",
        "https://public.example.test/",
      ]);
      expect(yield* Ref.get(progress)).toEqual([
        "preparing",
        "opening",
        "synchronizing",
        "preparing",
        "opening",
        "synchronizing",
      ]);
      expect(yield* Ref.get(releasedUrls)).toEqual([
        "http://lan.example.test/",
        "https://public.example.test/",
      ]);
    }),
  );

  it.effect("stops endpoint rotation on a blocked connection", () =>
    Effect.gen(function* () {
      const preparedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
      const resolver = ConnectionResolver.ConnectionResolver.of({
        prepare: (_entry, endpoint) =>
          Ref.update(preparedUrls, (values) => [...values, endpoint!.httpBaseUrl]).pipe(
            Effect.andThen(
              Effect.fail(
                new ConnectionBlockedError({
                  reason: "authentication",
                  detail: "The credential is invalid.",
                }),
              ),
            ),
          ),
      });
      const sessions = RpcSession.RpcSessionFactory.of({
        connect: () => Effect.die("A blocked endpoint must not open a session."),
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
        Effect.provide(
          ConnectionDriver.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
                Layer.succeed(RpcSession.RpcSessionFactory, sessions),
              ),
            ),
          ),
        ),
      );

      const error = yield* Effect.scoped(
        driver.connect(ENTRY, () => Effect.void).pipe(Effect.flip),
      );

      expect(error).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "authentication",
      });
      expect(yield* Ref.get(preparedUrls)).toEqual(["http://lan.example.test/"]);
    }),
  );

  it.effect("stops endpoint rotation when the remote server is unavailable", () =>
    Effect.gen(function* () {
      const preparedUrls = yield* Ref.make<ReadonlyArray<string>>([]);
      const resolver = ConnectionResolver.ConnectionResolver.of({
        prepare: (_entry, endpoint) =>
          Ref.update(preparedUrls, (values) => [...values, endpoint!.httpBaseUrl]).pipe(
            Effect.andThen(
              Effect.fail(
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  detail: "The server rejected initial synchronization.",
                }),
              ),
            ),
          ),
      });
      const sessions = RpcSession.RpcSessionFactory.of({
        connect: () => Effect.die("A remote-unavailable endpoint must not open another session."),
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
        Effect.provide(
          ConnectionDriver.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ConnectionResolver.ConnectionResolver, resolver),
                Layer.succeed(RpcSession.RpcSessionFactory, sessions),
              ),
            ),
          ),
        ),
      );

      const error = yield* Effect.scoped(
        driver.connect(ENTRY, () => Effect.void).pipe(Effect.flip),
      );

      expect(error).toMatchObject({
        _tag: "ConnectionTransientError",
        reason: "remote-unavailable",
      });
      expect(yield* Ref.get(preparedUrls)).toEqual(["http://lan.example.test/"]);
    }),
  );
});
