import ElectronStore from 'electron-store'
import type { Store, UsageEntry } from './ranking'

// electron-store v11 is ESM-only; when bundled to CJS for the main process,
// the default export sometimes arrives wrapped as `{ default: Store }` rather
// than interop-unwrapped. Handle both shapes.
const Conf = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

export interface AuthData {
  accessToken: string
  expiresAt: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppData extends Store {
  settings: Record<string, unknown>
  auth: AuthData | null
  windowBounds: WindowBounds | null
}

const defaults: AppData = {
  favorites: [],
  usage: {},
  settings: {},
  auth: null,
  windowBounds: null
}

export class AppStore {
  private store: ElectronStore<AppData>

  constructor() {
    this.store = new Conf<AppData>({ defaults })
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

  getWindowBounds(): WindowBounds | null {
    return this.store.get('windowBounds')
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.store.set('windowBounds', bounds)
  }
}
