import { WsRpcGroup } from "@t3tools/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { resolveServerUrl } from "../lib/utils";
import {
  getWsReconnectDelayMsForRetry,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  WS_RECONNECT_MAX_RETRIES,
} from "./wsConnectionState";

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);

type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;

export function createWsRpcProtocolLayer(url?: string) {
  const resolvedUrl = resolveServerUrl({
    url,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
    pathname: "/ws",
  });
  const trackingWebSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      recordWsConnectionAttempt(socketUrl);
      const socket = new globalThis.WebSocket(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          recordWsConnectionOpened();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          recordWsConnectionErrored("Unable to connect to the T3 server WebSocket.");
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          recordWsConnectionClosed({
            code: event.code,
            reason: event.reason,
          });
        },
        { once: true },
      );

      return socket;
    },
  );
  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(trackingWebSocketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(Schedule.recurs(WS_RECONNECT_MAX_RETRIES), (retryCount) =>
    Effect.succeed(Duration.millis(getWsReconnectDelayMsForRetry(retryCount) ?? 0)),
  );
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryPolicy,
      retryTransientErrors: true,
    }),
  );

  return protocolLayer.pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
}
