import { describe, expect, it } from 'vitest'
import { isValidPhone, normalizePhone } from './phone'

describe('phone', () => {
  it('normalisasi +62 / 62 / tanda baca', () => {
    expect(normalizePhone('+62 812-3456-7890')).toBe('081234567890')
    expect(normalizePhone('62812 3456 7890')).toBe('081234567890')
    expect(normalizePhone('(021) 555.1234')).toBe('0215551234')
  })
  it('validasi format Indonesia', () => {
    expect(isValidPhone('081234567890')).toBe(true)
    expect(isValidPhone('+6281234567890')).toBe(true)
    expect(isValidPhone('021-5551234')).toBe(true)
    expect(isValidPhone('12345')).toBe(false)
    expect(isValidPhone('0012345678')).toBe(false)
    expect(isValidPhone('08123')).toBe(false)
    expect(isValidPhone('08abc4567890')).toBe(false)
  })
})
