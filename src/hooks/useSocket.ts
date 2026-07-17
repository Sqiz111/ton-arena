'use client'

import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

const sockets = new Map<string, Socket>()

/** Module-level singleton per namespace; created lazily, survives re-renders. */
export function getSocket(namespace: string): Socket {
  let socket = sockets.get(namespace)
  if (!socket) {
    socket = io(namespace, { withCredentials: true })
    sockets.set(namespace, socket)
  }
  return socket
}

/**
 * Subscribe to socket events with automatic cleanup.
 * `handlers` is captured in a ref so consumers may pass a fresh object literal.
 */
export function useSocketEvents(
  namespace: string,
  handlers: Record<string, (...args: never[]) => void>,
  onConnect?: (socket: Socket) => void,
): Socket {
  const socket = getSocket(namespace)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const onConnectRef = useRef(onConnect)
  onConnectRef.current = onConnect

  useEffect(() => {
    const wrapped: Record<string, (...args: unknown[]) => void> = {}
    for (const event of Object.keys(handlersRef.current)) {
      wrapped[event] = (...args: unknown[]) =>
        (handlersRef.current[event] as (...a: unknown[]) => void)(...args)
      socket.on(event, wrapped[event])
    }
    const handleConnect = () => onConnectRef.current?.(socket)
    socket.on('connect', handleConnect)
    if (socket.connected) handleConnect()

    return () => {
      for (const [event, fn] of Object.entries(wrapped)) socket.off(event, fn)
      socket.off('connect', handleConnect)
    }
  }, [socket])

  return socket
}
