import { createServer } from 'node:net'
import { EventDispatcher, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk'

// Exercise the actual dependency in a separate process: an unhandled socket
// error must fail the test, not be swallowed by Vitest's global handlers.
// No platform credentials or external network are involved.
const sockets = new Set()
const server = createServer(socket => {
  sockets.add(socket)
  socket.on('error', () => {})
  socket.once('close', () => sockets.delete(socket))
  // Deliberately never answer the HTTP WebSocket upgrade.
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const result = new Promise(resolve => {
  const client = new WSClient({
    appId: 'cli_0000000000000000',
    appSecret: 'fake-local-test-secret',
    loggerLevel: LoggerLevel.fatal,
    autoReconnect: false,
    handshakeTimeoutMs: 40,
    httpInstance: {
      request: async () => ({
        code: 0,
        data: {
          URL: `ws://127.0.0.1:${address.port}/?device_id=local&service_id=1`,
          ClientConfig: { PingInterval: 30, ReconnectCount: 0, ReconnectInterval: 1, ReconnectNonce: 0 },
        },
      }),
    },
    onReady: () => { throw new Error('the stalled handshake must not become ready') },
    onError: () => {
      client.close({ force: true })
      // The ws CONNECTING termination error is emitted asynchronously.
      setTimeout(() => resolve('timeout-reported-without-process-crash'), 20)
    },
  })
  void client.start({ eventDispatcher: new EventDispatcher({}) })
})
process.stdout.write(`${await result}\n`)
for (const socket of sockets) socket.destroy()
await new Promise(resolve => server.close(resolve))
