import { describe, it, expect } from 'vitest'
import { buildErrorReport, formatReportText, buildMailtoUrl } from './error-report'

const ctx = { version: '0.1.3', platform: 'darwin' }

describe('buildErrorReport', () => {
  it('captures message and stack from an Error and sets the category title', () => {
    const err = new Error('OAuth2 Error: invalid_scope')
    const report = buildErrorReport(err, 'connection', ctx, 1000, 'id-1')

    expect(report.id).toBe('id-1')
    expect(report.category).toBe('connection')
    expect(report.title).toBe("Couldn't connect to Discord")
    expect(report.message).toBe('OAuth2 Error: invalid_scope')
    expect(report.stack).toBe(err.stack)
    expect(report.context).toEqual(ctx)
    expect(report.timestamp).toBe(1000)
  })

  it('stringifies a non-Error value and leaves stack undefined', () => {
    const report = buildErrorReport('boom', 'controller', ctx, 2000, 'id-2')

    expect(report.title).toBe('Controller input stopped')
    expect(report.message).toBe('boom')
    expect(report.stack).toBeUndefined()
  })

  it('uses the generic title for the unknown category', () => {
    const report = buildErrorReport(new Error('x'), 'unknown', ctx, 0, 'id-3')
    expect(report.title).toBe('Something went wrong')
  })
})

describe('formatReportText', () => {
  it('includes title, message, stack, version and platform', () => {
    const report = buildErrorReport(new Error('kaboom'), 'connection', ctx, 0, 'id')
    const text = formatReportText(report)

    expect(text).toContain("Couldn't connect to Discord")
    expect(text).toContain('kaboom')
    expect(text).toContain('0.1.3')
    expect(text).toContain('darwin')
    expect(text).toContain(report.stack as string)
  })
})

describe('buildMailtoUrl', () => {
  it('targets bug@sitcord.com with a url-encoded subject and body', () => {
    const report = buildErrorReport(new Error('kaboom'), 'connection', ctx, 0, 'id')
    const url = buildMailtoUrl(report)

    expect(url.startsWith('mailto:bug@sitcord.com?subject=')).toBe(true)
    expect(url).toContain('&body=')
    expect(decodeURIComponent(url.split('&body=')[1])).toContain('kaboom')
  })

  it('truncates an over-long body and marks it', () => {
    const big = new Error('x'.repeat(5000))
    const report = buildErrorReport(big, 'unknown', ctx, 0, 'id')
    const url = buildMailtoUrl(report, 200)
    const body = decodeURIComponent(url.split('&body=')[1])

    expect(body).toContain('truncated; full report on your clipboard')
    expect(body.length).toBeLessThan(300)
  })
})
