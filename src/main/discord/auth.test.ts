import { describe, it, expect, vi, afterEach } from 'vitest'
import { AuthManager, deriveChallenge, type AuthStore, type RpcRequester } from './auth'
import type { AuthData } from '../store'

// A fixed verifier so the derived PKCE challenge is deterministic in tests.
const VERIFIER = 'a'.repeat(43)

class MemoryAuthStore implements AuthStore {
  constructor(private auth: AuthData | null = null) {}
  getAuth(): AuthData | null {
    return this.auth
  }
  setAuth(auth: AuthData | null): void {
    this.auth = auth
  }
}

class MockRpc implements RpcRequester {
  calls: { cmd: string; args: unknown }[] = []
  constructor(private responses: Record<string, any>) {}
  async request(cmd: string, args: unknown): Promise<any> {
    this.calls.push({ cmd, args })
    return this.responses[cmd]
  }
}

function fetchJsonOnce(json: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => json
  })) as unknown as typeof fetch
}

function fetchErrorOnce(status: number, json: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => json
  })) as unknown as typeof fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthManager', () => {
  it('reuses a cached, unexpired token and skips AUTHORIZE', async () => {
    const store = new MemoryAuthStore({ accessToken: 'cached-token', expiresAt: 2000 })
    const rpc = new MockRpc({ AUTHENTICATE: { data: { user: { username: 'me' } } } })
    vi.stubGlobal('fetch', fetchJsonOnce({}))

    const auth = new AuthManager({ rpc, store, clientId: 'cid', clientSecret: 'secret' })
    await auth.authenticate(1000)

    expect(rpc.calls.map((c) => c.cmd)).toEqual(['AUTHENTICATE'])
    expect(rpc.calls[0].args).toEqual({ access_token: 'cached-token' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('with no token: AUTHORIZE then exchanges the code, stores it, then AUTHENTICATEs', async () => {
    const store = new MemoryAuthStore(null)
    const rpc = new MockRpc({
      AUTHORIZE: { data: { code: 'auth-code' } },
      AUTHENTICATE: { data: { user: { username: 'me' } } }
    })
    vi.stubGlobal('fetch', fetchJsonOnce({ access_token: 'fresh-token', expires_in: 604800 }))

    const auth = new AuthManager({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      generateVerifier: () => VERIFIER
    })
    await auth.authenticate(1000)

    expect(rpc.calls.map((c) => c.cmd)).toEqual(['AUTHORIZE', 'AUTHENTICATE'])
    // AUTHORIZE now carries the PKCE challenge derived from the verifier.
    expect(rpc.calls[0].args).toEqual({
      client_id: 'cid',
      scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
      code_challenge: deriveChallenge(VERIFIER),
      code_challenge_method: 'S256'
    })
    expect(rpc.calls[1].args).toEqual({ access_token: 'fresh-token' })
    expect(store.getAuth()).toEqual({ accessToken: 'fresh-token', expiresAt: 1000 + 604800 * 1000 })

    const [url, init] = (fetch as any).mock.calls[0]
    expect(url).toBe('https://discord.com/api/oauth2/token')
    expect(init.method).toBe('POST')
    const body = init.body as URLSearchParams
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('code_verifier')).toBe(VERIFIER)
    expect(body.get('grant_type')).toBe('authorization_code')
    // Secret still sent when this build provides one (confidential/owner).
    expect(body.get('client_secret')).toBe('secret')
  })

  it('public client (no secret) exchanges with PKCE and omits client_secret', async () => {
    const store = new MemoryAuthStore(null)
    const rpc = new MockRpc({
      AUTHORIZE: { data: { code: 'auth-code' } },
      AUTHENTICATE: { data: { user: { username: 'me' } } }
    })
    vi.stubGlobal('fetch', fetchJsonOnce({ access_token: 'fresh-token', expires_in: 604800 }))

    const auth = new AuthManager({ rpc, store, clientId: 'cid', generateVerifier: () => VERIFIER })
    await auth.authenticate(1000)

    const body = (fetch as any).mock.calls[0][1].body as URLSearchParams
    expect(body.get('code_verifier')).toBe(VERIFIER)
    expect(body.has('client_secret')).toBe(false)
  })

  it('throws Discord error_description and does not poison the store on a failed exchange', async () => {
    const store = new MemoryAuthStore(null)
    const rpc = new MockRpc({ AUTHORIZE: { data: { code: 'auth-code' } } })
    vi.stubGlobal(
      'fetch',
      fetchErrorOnce(400, { error: 'invalid_grant', error_description: 'Bad code' })
    )

    const auth = new AuthManager({ rpc, store, clientId: 'cid', generateVerifier: () => VERIFIER })

    await expect(auth.authenticate(1000)).rejects.toThrow('Bad code')
    expect(store.getAuth()).toBeNull()
  })

  it('an expired cached token triggers a fresh AUTHORIZE', async () => {
    const store = new MemoryAuthStore({ accessToken: 'old-token', expiresAt: 500 })
    const rpc = new MockRpc({
      AUTHORIZE: { data: { code: 'auth-code' } },
      AUTHENTICATE: { data: { user: { username: 'me' } } }
    })
    vi.stubGlobal('fetch', fetchJsonOnce({ access_token: 'fresh-token', expires_in: 604800 }))

    const auth = new AuthManager({ rpc, store, clientId: 'cid', clientSecret: 'secret' })
    await auth.authenticate(1000)

    expect(rpc.calls.map((c) => c.cmd)).toEqual(['AUTHORIZE', 'AUTHENTICATE'])
    expect(store.getAuth()).toEqual({ accessToken: 'fresh-token', expiresAt: 1000 + 604800 * 1000 })
  })
})
