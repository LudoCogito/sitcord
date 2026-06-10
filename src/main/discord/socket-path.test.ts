import { describe, it, expect } from 'vitest'
import { candidatePaths } from './socket-path'

describe('candidatePaths', () => {
  it('returns named pipe candidates discord-ipc-0..9 on win32', () => {
    const paths = candidatePaths({}, 'win32')
    expect(paths).toEqual(Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`))
  })

  it('returns unix socket candidates under XDG_RUNTIME_DIR, TMPDIR, /tmp and /var/run', () => {
    const paths = candidatePaths({ XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/tmp/xyz' }, 'linux')

    expect(paths).toContain('/run/user/1000/discord-ipc-0')
    expect(paths).toContain('/tmp/xyz/discord-ipc-0')
    expect(paths).toContain('/tmp/discord-ipc-0')
    expect(paths).toContain('/var/run/discord-ipc-0')
    expect(paths).toContain('/run/user/1000/snap.discord/discord-ipc-0')
    expect(paths).toContain('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0')
    expect(paths).toContain('/run/user/1000/discord-ipc-9')
  })

  it('dedupes directories that resolve to the same path', () => {
    const paths = candidatePaths({ TMPDIR: '/tmp', XDG_RUNTIME_DIR: undefined }, 'darwin')

    expect(paths.filter((p) => p === '/tmp/discord-ipc-0')).toHaveLength(1)
  })
})
