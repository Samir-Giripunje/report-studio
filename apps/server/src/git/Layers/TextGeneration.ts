/**
 * TextGenerationLive - Stub layer for AI-powered git text generation.
 *
 * Returns a descriptive error for all methods until an API-based provider
 * is wired up. Replace this layer with a real implementation backed by
 * your chosen LLM API.
 *
 * @module TextGenerationLive
 */
import { Effect, Layer } from "effect";
import { TextGenerationError } from "@t3tools/contracts";

import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";

const notImplemented = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "No text generation provider configured. Wire an API-based TextGeneration layer.",
    }),
  );

const impl: TextGenerationShape = {
  generateCommitMessage: () => notImplemented("generateCommitMessage"),
  generatePrContent: () => notImplemented("generatePrContent"),
  generateBranchName: () => notImplemented("generateBranchName"),
  generateThreadTitle: () => notImplemented("generateThreadTitle"),
};

export const TextGenerationLive = Layer.succeed(TextGeneration, impl);
