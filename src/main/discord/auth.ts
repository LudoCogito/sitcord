import type { AuthData } from '../store'

export interface AuthStore {
  getAuth(): AuthData | null
  setAuth(auth: AuthData | null): void
}

export interface RpcRequester {
  request(cmd: string, args: unknown): Promise<any>
}

export interface AuthManagerOptions {
  rpc: RpcRequester
  store: AuthStore
  clientId: string
  clientSecret: string
}

const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write']
const REDIRECT_URI = 'http://localhost'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'

export class AuthManager {
  private readonly rpc: RpcRequester
  private readonly store: AuthStore
  private readonly clientId: string
  private readonly clientSecret: string

  constructor(options: AuthManagerOptions) {
    this.rpc = options.rpc
    this.store = options.store
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
  }

  async authenticate(now: number): Promise<any> {
    let auth = this.store.getAuth()
    if (!auth || auth.expiresAt <= now) {
      auth = await this.authorize(now)
      this.store.setAuth(auth)
    }
    return this.rpc.request('AUTHENTICATE', { access_token: auth.accessToken })
  }

  private async authorize(now: number): Promise<AuthData> {
    const authorizeRes = await this.rpc.request('AUTHORIZE', { client_id: this.clientId, scopes: SCOPES })
    const code = authorizeRes.data.code
    const token = await this.exchangeCode(code)
    return { accessToken: token.access_token, expiresAt: now + token.expires_in * 1000 }
  }

  // Seam for the distribution build: swap this for a PKCE-based exchange
  // (no client_secret, see Task 0 findings) without touching the rest of the flow.
  private async exchangeCode(code: string): Promise<{ access_token: string; expires_in: number }> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    })
    return res.json()
  }
}
