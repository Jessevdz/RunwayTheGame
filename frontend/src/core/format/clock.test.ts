import { describe, expect, it } from 'vitest'
import { formatClock, formatDurationWords } from './clock'

describe('formatClock', () => {
  it('formats under one minute as m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(59)).toBe('0:59')
  })

  it('formats multiple minutes without hours as m:ss', () => {
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
    expect(formatClock(3599)).toBe('59:59')
  })

  it('formats hours with leading zero for minutes and seconds as h:mm:ss', () => {
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3665)).toBe('1:01:05')
    expect(formatClock(7325)).toBe('2:02:05')
  })

  it('clamps negative values to 0', () => {
    expect(formatClock(-10)).toBe('0:00')
  })

  it('floors fractional seconds', () => {
    expect(formatClock(12.9)).toBe('0:12')
  })
})

describe('formatDurationWords', () => {
  it('formats durations under 60 seconds in seconds', () => {
    expect(formatDurationWords(0)).toBe('0 sec')
    expect(formatDurationWords(45)).toBe('45 sec')
    expect(formatDurationWords(59)).toBe('59 sec')
  })

  it('formats durations under one hour in minutes', () => {
    expect(formatDurationWords(60)).toBe('1 min')
    expect(formatDurationWords(1800)).toBe('30 min')
    expect(formatDurationWords(3540)).toBe('59 min')
  })

  it('formats round hours as hr', () => {
    expect(formatDurationWords(3600)).toBe('1 hr')
    expect(formatDurationWords(7200)).toBe('2 hr')
  })

  it('formats hours and minutes', () => {
    expect(formatDurationWords(4500)).toBe('1 hr 15 min')
  })

  it('clamps negative values to 0 sec', () => {
    expect(formatDurationWords(-50)).toBe('0 sec')
  })
})
