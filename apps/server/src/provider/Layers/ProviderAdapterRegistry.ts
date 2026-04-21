/**
 * ProviderAdapterRegistryLive - In-memory provider adapter lookup layer.
 *
 * Binds provider kinds to concrete adapter services.
 * Currently empty — add API-based provider adapters here.
 *
 * @module ProviderAdapterRegistryLive
 */
import { Effect, Layer } from "effect";

import { ProviderUnsupportedError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";

export interface ProviderAdapterRegistryLiveOptions {
  readonly adapters?: ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>;
}

function makeProviderAdapterRegistry(
  options?: ProviderAdapterRegistryLiveOptions,
): ProviderAdapterRegistryShape {
  const adapters = options?.adapters ?? [];
  const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));

  const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
    const adapter = byProvider.get(provider);
    if (!adapter) {
      return Effect.fail(new ProviderUnsupportedError({ provider }));
    }
    return Effect.succeed(adapter);
  };

  const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
    Effect.sync(() => Array.from(byProvider.keys()));

  return { getByProvider, listProviders };
}

export const ProviderAdapterRegistryLive = Layer.sync(ProviderAdapterRegistry, () =>
  makeProviderAdapterRegistry(),
);
