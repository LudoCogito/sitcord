import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

export function candidatePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  }

  const dirs = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, '/tmp', '/var/run'].filter((d): d is string => Boolean(d)))]

  const paths: string[] = []
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) {
      paths.push(path.join(dir, `discord-ipc-${i}`))
      paths.push(path.join(dir, 'snap.discord', `discord-ipc-${i}`))
      paths.push(path.join(dir, 'app/com.discordapp.Discord', `discord-ipc-${i}`))
    }
  }
  return paths
}

function tryConnect(candidates: string[], index: number): Promise<net.Socket> {
  if (index >= candidates.length) return Promise.reject(new Error('No Discord IPC socket found'))

  const candidate = candidates[index]
  if (process.platform !== 'win32' && !fs.existsSync(candidate)) {
    return tryConnect(candidates, index + 1)
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(candidate)
    const onError = (): void => {
      socket.removeAllListeners()
      tryConnect(candidates, index + 1).then(resolve, reject)
    }
    socket.once('connect', () => {
      socket.removeListener('error', onError)
      resolve(socket)
    })
    socket.once('error', onError)
  })
}

export function connectSocket(): Promise<net.Socket> {
  return tryConnect(candidatePaths(process.env, process.platform), 0)
}
