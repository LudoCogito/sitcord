// The shape of a Discord RPC response / dispatch envelope. Replaces the bare
// `any` that used to flow out of the rpc-client and deep into the service.
//
// `data` is intentionally a loose, mostly-optional bag — its fields vary per
// command and event — but the fields we actually read are declared so they
// autocomplete and typos are caught, while the index signature keeps it open
// for the rest (e.g. AUTHENTICATE's `user`).
export interface RpcResponse {
  cmd?: string
  evt?: string | null
  nonce?: string | null
  data?: RpcData
}

export interface RpcData {
  // OAuth (AUTHORIZE)
  code?: string
  // GET_GUILDS
  guilds?: { id: string; name: string }[]
  // GET_CHANNELS
  channels?: { id: string; name: string; type: number }[]
  // GET_GUILD
  icon_url?: string | null
  // GET_SELECTED_VOICE_CHANNEL
  id?: string | null
  // VOICE_CHANNEL_SELECT
  channel_id?: string | null
  // GET_CHANNEL (occupancy)
  voice_states?: unknown[]
  // GET/SET_VOICE_SETTINGS, VOICE_SETTINGS_UPDATE
  mute?: boolean
  deaf?: boolean
  input?: { volume?: number }
  output?: { volume?: number }
  // ERROR
  message?: string
  [key: string]: unknown
}
