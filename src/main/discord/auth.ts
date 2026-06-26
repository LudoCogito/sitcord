import { createHash, randomBytes } from 'node:crypto'
import type { AuthData } from '../store'
import type { RpcResponse } from './types'

export interface AuthStore {
  getAuth(): AuthData | null
  setAuth(auth: AuthData | null): void
}

export interface RpcRequester {
  request(cmd: string, args: unknown): Promise<RpcResponse>
}

export interface AuthManagerOptions {
  rpc: RpcRequester
  store: AuthStore
  clientId: string
  // Optional: a public (PKCE) client omits the secret entirely. Provide it only
  // for a confidential/owner build; distributed builds leave it undefined.
  clientSecret?: string
  // Injectable so tests can pin the PKCE verifier; defaults to a random one.
  generateVerifier?: () => string
}

const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write']
const REDIRECT_URI = 'http://localhost'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// PKCE code challenge: base64url(SHA256(verifier)) without padding. Discord only
// supports the S256 method (not plain).
export function deriveChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

// 32 random bytes → 43 base64url chars, inside Discord's 43–128 char / [A-Za-z0-9-._~]
// requirement. A fresh verifier is generated per authorization request.
function defaultVerifier(): string {
  return base64url(randomBytes(32))
}

export class AuthManager {
  private readonly rpc: RpcRequester
  private readonly store: AuthStore
  private readonly clientId: string
  private readonly clientSecret?: string
  private readonly generateVerifier: () => string

  constructor(options: AuthManagerOptions) {
    this.rpc = options.rpc
    this.store = options.store
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.generateVerifier = options.generateVerifier ?? defaultVerifier
  }

  async authenticate(now: number): Promise<RpcResponse> {
    let auth = this.store.getAuth()
    if (!auth || auth.expiresAt <= now) {
      auth = await this.authorize(now)
      this.store.setAuth(auth)
    }
    return this.rpc.request('AUTHENTICATE', { access_token: auth.accessToken })
  }

  private async authorize(now: number): Promise<AuthData> {
    // Confidential clients (with secret) use a simple AUTHORIZE — no PKCE fields.
    // Discord's local RPC enforces stricter scope validation (rejecting privileged
    // scopes like rpc.voice.write) on the PKCE/public-client path. Once Discord
    // RPC approval is granted (Task 12), switch to PKCE-only for public builds.
    let verifier: string | undefined
    const authorizeArgs: Record<string, unknown> = {
      client_id: this.clientId,
      scopes: SCOPES
    }
    if (!this.clientSecret) {
      verifier = this.generateVerifier()
      authorizeArgs.code_challenge = deriveChallenge(verifier)
      authorizeArgs.code_challenge_method = 'S256'
    }
    const authorizeRes = await this.rpc.request('AUTHORIZE', authorizeArgs)
    const code = authorizeRes.data?.code
    if (!code) throw new Error('Discord did not return an authorization code')
    const token = await this.exchangeCode(code, verifier)
    return { accessToken: token.access_token, expiresAt: now + token.expires_in * 1000 }
  }

  private async exchangeCode(
    code: string,
    verifier: string | undefined
  ): Promise<{ access_token: string; expires_in: number }> {
    const params: Record<string, string> = {
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }
    if (verifier) params.code_verifier = verifier
    // Confidential/owner builds pass the secret; public PKCE clients omit it
    // (requires the PUBLIC_OAUTH2_CLIENT flag on the Discord application).
    if (this.clientSecret) params.client_secret = this.clientSecret

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    })
    // A non-2xx means a misconfigured client (wrong/missing PUBLIC_OAUTH2_CLIENT
    // flag, bad redirect, rejected PKCE, …). Surface Discord's error_description
    // instead of returning a body with an undefined access_token, which would
    // poison the store with a NaN expiry and fail AUTHENTICATE opaquely.
    if (!res.ok) {
      const detail = await res.json().then(
        (body: { error?: string; error_description?: string }) =>
          body?.error_description || body?.error || '',
        () => ''
      )
      throw new Error(`Discord token exchange failed (${res.status})${detail ? `: ${detail}` : ''}`)
    }
    return res.json()
  }
}
