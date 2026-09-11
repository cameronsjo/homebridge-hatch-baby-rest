import { Subject } from 'rxjs'
import type {
  Characteristic,
  CharacteristicSetHandler,
  CharacteristicValue,
} from 'homebridge'
import { describe, expect, it, vi } from 'vitest'
import { BaseAccessory } from '../base-accessory.ts'

function createCharacteristicHarness(): {
  characteristic: Characteristic
  onSet: ReturnType<typeof vi.fn>
  updateValue: ReturnType<typeof vi.fn>
  getSetHandler: () => CharacteristicSetHandler
} {
  let setHandler: CharacteristicSetHandler | undefined
  const onSet = vi.fn((handler: CharacteristicSetHandler) => {
      setHandler = handler
      return {} as Characteristic
    }),
    updateValue = vi.fn(() => ({}) as Characteristic),
    characteristic = { onSet, updateValue } as unknown as Characteristic

  return {
    characteristic,
    onSet,
    updateValue,
    getSetHandler: () => {
      expect(setHandler).toBeDefined()
      return setHandler!
    },
  }
}

function createAccessory(): BaseAccessory {
  return Object.create(BaseAccessory.prototype) as BaseAccessory
}

describe('BaseAccessory.registerCharacteristic', () => {
  it('registers a modern set handler when a setter is provided', () => {
    const { characteristic, onSet } = createCharacteristicHarness()

    createAccessory().registerCharacteristic(
      characteristic,
      new Subject<CharacteristicValue>(),
      vi.fn(),
    )

    expect(onSet).toHaveBeenCalledOnce()
  })

  it('forwards the exact characteristic value and waits for setter completion', async () => {
    const { characteristic, getSetHandler } = createCharacteristicHarness()
    let resolveSetter: (() => void) | undefined
    const setterResult = new Promise<void>((resolve) => {
        resolveSetter = resolve
      }),
      setter = vi.fn(() => setterResult),
      value = { exact: 'value' } satisfies CharacteristicValue

    createAccessory().registerCharacteristic(
      characteristic,
      new Subject<CharacteristicValue>(),
      setter,
    )

    const handlerResult = getSetHandler()(value, undefined)
    expect(setter).toHaveBeenCalledWith(value)
    expect(handlerResult).toBe(setterResult)

    let completed = false
    void Promise.resolve(handlerResult).then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    resolveSetter!()
    await expect(handlerResult).resolves.toBeUndefined()
    expect(completed).toBe(true)
  })

  it('propagates setter promise rejection', async () => {
    const { characteristic, getSetHandler } = createCharacteristicHarness(),
      error = new Error('setter failed')

    createAccessory().registerCharacteristic(
      characteristic,
      new Subject<CharacteristicValue>(),
      () => Promise.reject(error),
    )

    await expect(getSetHandler()(true, undefined)).rejects.toBe(error)
  })

  it('does not register a set handler when no setter is provided', () => {
    const { characteristic, onSet } = createCharacteristicHarness()

    createAccessory().registerCharacteristic(
      characteristic,
      new Subject<CharacteristicValue>(),
    )

    expect(onSet).not.toHaveBeenCalled()
  })

  it('updates the characteristic only when the observable value changes', () => {
    const { characteristic, updateValue } = createCharacteristicHarness(),
      values = new Subject<CharacteristicValue>()

    createAccessory().registerCharacteristic(characteristic, values)
    values.next(10)
    values.next(10)
    values.next(20)

    expect(updateValue.mock.calls).toEqual([[10], [20]])
  })
})
