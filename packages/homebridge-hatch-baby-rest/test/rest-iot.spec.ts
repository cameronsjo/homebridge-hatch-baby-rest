import { beforeAll, describe, expect, it, vi } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { useLogger } from '../../shared/util.ts'
import { Product } from '../../shared/hatch-sleep-types.ts'
import { RestIot } from '../rest-iot.ts'
import type { RestClient } from '../rest-client.ts'
import {
  clientSubject,
  connectWithShadow,
  deviceInfo,
  FakeMqttClient,
  flush,
} from './fake-mqtt-client.ts'

beforeAll(() => {
  useLogger({ logInfo: () => {}, logError: () => {} })
})

function createRestIot(
  product: string = Product.restoreIot,
  routines: any[] = [],
) {
  const client = new FakeMqttClient(),
    restClient = {
      request: vi.fn(async () => routines),
    } as unknown as RestClient,
    device = new RestIot(
      deviceInfo({ product: product as any }),
      clientSubject(client),
      restClient,
    )

  return { client, device, restClient }
}

async function connected(product?: string, routines?: any[]) {
  const harness = createRestIot(product, routines)
  connectWithShadow(harness.client, 'thing-1', {
    reported: {
      current: { playing: 'none', step: 0, srId: 0, sound: { v: 32768 } },
      deviceInfo: { f: '1.2.3' },
    },
  })
  await flush()
  return harness
}

describe('RestIot.model', () => {
  it.each([
    [Product.restoreIot, 'Restore IoT'],
    [Product.riotPlus, 'Rest+ 2nd Gen'],
    [Product.riot, 'Rest 2nd Gen'],
  ])('labels %s as %s', (product, model) => {
    expect(createRestIot(product).device.model).toBe(model)
  })
})

describe('RestIot state', () => {
  it('reports volume as a percentage', async () => {
    const { device } = await connected()
    expect(await firstValueFrom(device.onVolume)).toBe(50)
  })

  it('reports whether content is playing', async () => {
    const { device } = await connected()
    expect(await firstValueFrom(device.onSomeContentPlaying)).toBe(false)
  })
})

describe('RestIot commands', () => {
  it('always sends paused: false when turning off', async () => {
    const { client, device } = await connected()

    device.turnOff()
    await flush()

    expect(client.updates.at(-1)).toEqual({
      state: {
        desired: {
          current: { playing: 'none', step: 0, srId: 0, paused: false },
        },
      },
    })
  })

  it('scales volume to the device range', async () => {
    const { client, device } = await connected()

    device.setVolume(100)
    await flush()

    expect(client.updates.at(-1)).toEqual({
      state: { desired: { current: { sound: { v: 65535 } } } },
    })
  })

  it('starts the first touch-ring routine by display order, with volume', async () => {
    const { client, device } = await connected(Product.restoreIot, [
      { id: 30, type: 'custom', displayOrder: 0, button0: false },
      { id: 20, type: 'custom', displayOrder: 2, button0: true },
      { id: 10, type: 'favorite', displayOrder: 1 },
    ])

    await device.turnOnRoutine(40)
    await flush()

    expect(client.updates.at(-1)).toEqual({
      state: {
        desired: {
          current: {
            playing: 'routine',
            step: 1,
            srId: 10,
            paused: false,
            sound: { v: 26214 },
          },
        },
      },
    })
  })

  it('sends nothing when no touch-ring routine exists', async () => {
    const { client, device } = await connected(Product.restoreIot, [
      { id: 30, type: 'custom', displayOrder: 0 },
    ])

    await device.turnOnRoutine()
    await flush()

    expect(client.updates).toEqual([])
  })

  it('does not throw when fetching routines fails', async () => {
    const { client, device, restClient } = await connected()
    vi.mocked(restClient.request).mockRejectedValueOnce(new Error('429'))

    await expect(device.turnOnRoutine()).resolves.toBeUndefined()
    expect(client.updates).toEqual([])
  })
})
