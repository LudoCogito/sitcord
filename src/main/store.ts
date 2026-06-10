import ElectronStore from 'electron-store'
import type { Store, UsageEntry } from './ranking'

export interface AuthData {
  accessToken: string
  expiresAt: number
}

export interface AppData extends Store {
  settings: Record<string, unknown>
  auth: AuthData | null
}

const defaults: AppData = {
  favorites: [],
  usage: {},
  settings: {},
  auth: null
}

export class AppStore {
  private store: ElectronStore<AppData>

  constructor() {
    this.store = new ElectronStore<AppData>({ defaults })
  }

  get(): Store {
    return { favorites: this.store.get('favorites'), usage: this.store.get('usage') }
  }

  setFavorites(favorites: string[]): void {
    this.store.set('favorites', favorites)
  }

  setUsage(usage: Record<string, UsageEntry>): void {
    this.store.set('usage', usage)
  }

  getAuth(): AuthData | null {
    return this.store.get('auth')
  }

  setAuth(auth: AuthData | null): void {
    this.store.set('auth', auth)
  }
}
