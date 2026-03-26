import { describe, it, expect } from 'vitest'
import { parseBudget } from '../../src/commands/run.js'

describe('parseBudget', () => {
  it('parses a plain number string', () => {
    const b = parseBudget('2.50', '10')
    expect(b.maxUsd).toBe(2.50)
    expect(b.maxExperimentsPerRun).toBe(10)
  })

  it('strips leading $ sign', () => {
    const b = parseBudget('$1.00', '5')
    expect(b.maxUsd).toBe(1.00)
  })

  it('sets warnAtUsd to 75% of maxUsd', () => {
    const b = parseBudget('4.00', '10')
    expect(b.warnAtUsd).toBeCloseTo(3.00, 5)
  })

  it('throws for non-numeric budget', () => {
    expect(() => parseBudget('invalid', '10')).toThrow('Invalid budget value')
  })

  it('throws for zero budget', () => {
    expect(() => parseBudget('0', '10')).toThrow('Invalid budget value')
  })

  it('throws for negative budget', () => {
    expect(() => parseBudget('-1.50', '10')).toThrow('Invalid budget value')
  })

  it('throws for non-integer maxExperiments', () => {
    expect(() => parseBudget('2.00', 'abc')).toThrow('Invalid max-experiments')
  })

  it('throws for zero maxExperiments', () => {
    expect(() => parseBudget('2.00', '0')).toThrow('Invalid max-experiments')
  })

  it('accepts maxExperiments of 1', () => {
    const b = parseBudget('1.00', '1')
    expect(b.maxExperimentsPerRun).toBe(1)
  })
})
