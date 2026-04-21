import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes observability settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(
        decodePatch({
          observability: {
            otlpTracesUrl: "http://localhost:4318/v1/traces",
          },
        }),
        {
          observability: {
            otlpTracesUrl: "http://localhost:4318/v1/traces",
          },
        },
      );
    }),
  );

  it.effect("decodes provider API key patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(
        decodePatch({
          providerApiKeys: {
            openai: "sk-openai",
          },
        }),
        {
          providerApiKeys: {
            openai: "sk-openai",
          },
        },
      );
    }),
  );

  it.effect("trims provider API keys when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providerApiKeys: {
          openai: "  sk-openai  ",
          claude: "  sk-claude  ",
          gemini: "  sk-gemini  ",
        },
      });

      assert.deepEqual(next.providerApiKeys, {
        openai: "sk-openai",
        claude: "sk-claude",
        gemini: "sk-gemini",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      yield* serverSettings.updateSettings({
        providerApiKeys: {
          openai: "sk-openai",
        },
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        providerApiKeys: {
          openai: "sk-openai",
        },
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("deep merges nested observability updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
        },
      });

      const next = yield* serverSettings.updateSettings({
        observability: {
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
      });

      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("deep merges provider API key updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providerApiKeys: {
          openai: "sk-openai",
        },
      });

      const next = yield* serverSettings.updateSettings({
        providerApiKeys: {
          gemini: "sk-gemini",
        },
      });

      assert.deepEqual(next.providerApiKeys, {
        openai: "sk-openai",
        claude: "",
        gemini: "sk-gemini",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("returns defaults on fresh settings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const settings = yield* serverSettings.getSettings;
      assert.deepEqual(settings, DEFAULT_SERVER_SETTINGS);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
