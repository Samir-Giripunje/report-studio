/**
 * ProviderRegistryLive - Aggregates provider snapshot services.
 *
 * Currently returns an empty provider list — add API-based providers here.
 *
 * @module ProviderRegistryLive
 */
import type { ProviderKind, ServerProvider } from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry";

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => previousProviders.length !== nextProviders.length;

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([]);

    const syncProviders = Effect.fn("syncProviders")(function* (_options?: {
      readonly publish?: boolean;
    }) {
      return yield* Ref.get(providersRef);
    });

    const refresh = Effect.fn("refresh")(function* (_provider?: ProviderKind) {
      return yield* Ref.get(providersRef);
    });

    return {
      getProviders: syncProviders().pipe(
        Effect.tapError(Effect.logError),
        Effect.orElseSucceed(() => []),
      ),
      refresh: (provider?: ProviderKind) =>
        refresh(provider).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => []),
        ),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
);
