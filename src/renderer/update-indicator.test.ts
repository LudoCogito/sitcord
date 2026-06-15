import { describe, it, expect } from 'vitest'
import { updateIndicator } from './update-indicator'

describe('updateIndicator', () => {
  it('shows the current version, prefixed with v, when no update is available', () => {
    expect(updateIndicator({ version: '1.2.0', updateAvailable: false })).toEqual({
      text: 'v1.2.0',
      available: false
    })
  })

  it('shows "Update available" (flagged) when an update is detected', () => {
    expect(updateIndicator({ version: '1.2.0', updateAvailable: true })).toEqual({
      text: 'Update available',
      available: true
    })
  })

  it('renders nothing until the version is known (avoids a bare "v")', () => {
    expect(updateIndicator({ version: '', updateAvailable: false })).toEqual({
      text: '',
      available: false
    })
  })

  it('still flags an available update even before the version arrives', () => {
    expect(updateIndicator({ version: '', updateAvailable: true })).toEqual({
      text: 'Update available',
      available: true
    })
  })
})
