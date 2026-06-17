import { describe, it, expect } from 'vitest'
import { detectController, glyphsFor, buildLegend, settingsChip } from './controller-profile'

describe('detectController', () => {
  it('detects Xbox controllers from the gamepad id', () => {
    expect(
      detectController('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)')
    ).toBe('xbox')
    expect(detectController('Xbox 360 Controller')).toBe('xbox')
  })

  it('detects PlayStation controllers by name or Sony vendor id', () => {
    expect(detectController('DualSense Wireless Controller')).toBe('playstation')
    expect(detectController('DUALSHOCK 4 Wireless Controller')).toBe('playstation')
    expect(
      detectController('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')
    ).toBe('playstation')
  })

  it('detects Steam controllers', () => {
    expect(detectController('Steam Controller')).toBe('steam')
    expect(detectController('Steam Virtual Gamepad')).toBe('steam')
  })

  it('falls back to generic for unknown or empty ids', () => {
    expect(detectController('Some Random HID Pad')).toBe('generic')
    expect(detectController('')).toBe('generic')
  })
})

describe('glyphsFor', () => {
  it('uses face letters for xbox, steam and generic', () => {
    for (const kind of ['xbox', 'steam', 'generic'] as const) {
      const g = glyphsFor(kind)
      expect(g.a).toBe('A')
      expect(g.b).toBe('B')
      expect(g.x).toBe('X')
      expect(g.y).toBe('Y')
    }
  })

  it('uses shape symbols and L1/R1 naming for playstation', () => {
    const g = glyphsFor('playstation')
    expect(g.a).toBe('✕')
    expect(g.b).toBe('○')
    expect(g.x).toBe('□')
    expect(g.y).toBe('△')
    expect(g.lb).toBe('L1')
    expect(g.rt).toBe('R2')
  })
})

describe('buildLegend', () => {
  it('lists the voice actions in channel mode with the right glyph', () => {
    const entries = buildLegend('xbox', 'channels')
    const labels = entries.map((e) => e.label)
    expect(labels).toContain('Join')
    expect(labels).toContain('Disconnect')
    expect(labels).toContain('Mute')
    expect(labels).toContain('Deafen')
    expect(labels).toContain('Hold: reorder server')
    expect(entries.find((e) => e.label === 'Join')?.icon).toBe('A')
    // Reorder is a long-press of the Join button (A), used on a server header.
    expect(entries.find((e) => e.label === 'Hold: reorder server')?.icon).toBe('A')
    // Volume: hold a bumper + d-pad ◀/▶ (mic on LB, Discord on RB).
    expect(labels).toContain('Mic volume')
    expect(labels).toContain('Discord volume')
    expect(entries.find((e) => e.label === 'Mic volume')?.icon).toBe('LB ◀▶')
    expect(entries.find((e) => e.label === 'Discord volume')?.icon).toBe('RB ◀▶')
  })

  it('maps Join to the cross glyph on playstation', () => {
    const entries = buildLegend('playstation', 'channels')
    expect(entries.find((e) => e.label === 'Join')?.icon).toBe('✕')
  })

  it('menu mode only exposes select, zoom and show/hide', () => {
    const labels = buildLegend('xbox', 'menu').map((e) => e.label)
    expect(labels).toEqual(['Select', 'Zoom', 'Show/Hide'])
  })

  it('maps show/hide to the LB+R3 chord (the order it triggers in)', () => {
    expect(buildLegend('xbox', 'channels').find((e) => e.label === 'Show/Hide')?.icon).toBe('LB+R3')
    expect(buildLegend('playstation', 'channels').find((e) => e.label === 'Show/Hide')?.icon).toBe(
      'L1+R3'
    )
  })
})

describe('settingsChip', () => {
  it('maps the Select button to Settings, and to Close while open', () => {
    expect(settingsChip('xbox', false)).toEqual({ icon: 'Select', label: 'Settings' })
    expect(settingsChip('xbox', true)).toEqual({ icon: 'Select', label: 'Close' })
  })

  it('uses the PlayStation Create glyph for the Select button', () => {
    expect(settingsChip('playstation', false)).toEqual({ icon: 'Create', label: 'Settings' })
  })
})
