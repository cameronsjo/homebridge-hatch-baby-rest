import { beforeAll, describe, expect, it } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { useLogger } from '../../shared/util.ts'
import {
  assignState,
  convertFromPercentage,
  convertToPercentage,
  IotDevice,
  MAX_IOT_VALUE,
} from '../iot-device.ts'
import {
  ackLastUpdate,
  clientSubject,
  connectWithShadow,
  deviceInfo,
  FakeMqttClient,
  flush,
} from './fake-mqtt-client.ts'

beforeAll(() => {
  useLogger({ logInfo: () => {}, logError: () => {} })
})

describe('assignState', () => {
  it('deep merges nested changes over the previous state', () => {
    const merged = assignState<any>(
      { current: { playing: 'none', sound: { v: 10, id: 3 } }, env: 'prod' },
      { current: { sound: { v: 20 } } },
    )

    expect(merged).toEqual({
      current: { playing: 'none', sound: { v: 20, id: 3 } },
      env: 'prod',
    })
  })

  it('does not mutate the previous state', () => {
    const previous = { current: { step: 1 } }
    assignState(previous, { current: { step: 2 } })
    expect(previous).toEqual({ current: { step: 1 } })
  })

  it('handles a missing previous state with nested changes', () => {
    // A shadow with only a desired section reaches here as (undefined, desired)
    expect(
      assignState<any>(undefined, { current: { playing: 'routine' } }),
    ).toEqual({ current: { playing: 'routine' } })
  })

  it('keeps null values instead of turning them into empty objects', () => {
    expect(assignState<any>({ timer: { s: 'x' } }, { timer: null })).toEqual({
      timer: null,
    })
  })

  it('replaces arrays wholesale, as AWS IoT shadows do', () => {
    expect(assignState<any>({ list: [1, 2, 3] }, { list: [4] })).toEqual({
      list: [4],
    })
  })
})

describe('percentage conversion', () => {
  it('maps the ends of the range exactly', () => {
    expect(convertFromPercentage(0)).toBe(0)
    expect(convertFromPercentage(100)).toBe(MAX_IOT_VALUE)
    expect(convertToPercentage(0)).toBe(0)
    expect(convertToPercentage(MAX_IOT_VALUE)).toBe(100)
  })

  it('round-trips every whole percentage', () => {
    for (let percent = 0; percent <= 100; percent++) {
      expect(convertToPercentage(convertFromPercentage(percent))).toBe(percent)
    }
  })
})

describe('IotDevice', () => {
  it('emits the merged initial shadow state', async () => {
    const client = new FakeMqttClient(),
      device = new IotDevice<any>(deviceInfo(), clientSubject(client))

    connectWithShadow(client, 'thing-1', {
      reported: { current: { playing: 'none', step: 0 } },
      desired: { current: { playing: 'routine' } },
    })

    expect(await device.getCurrentState()).toEqual({
      current: { playing: 'routine', step: 0 },
    })
  })

  it('survives a shadow with no reported section', async () => {
    const client = new FakeMqttClient(),
      device = new IotDevice<any>(deviceInfo(), clientSubject(client))

    connectWithShadow(client, 'thing-1', {
      desired: { current: { playing: 'routine' } },
    })

    expect(await device.getCurrentState()).toEqual({
      current: { playing: 'routine' },
    })
  })

  it('ignores status messages for other things', async () => {
    const client = new FakeMqttClient(),
      device = new IotDevice<any>(deviceInfo(), clientSubject(client))

    client.emit('connect')
    client.emit('status', 'other-thing', 'accepted', client.lastToken(), {
      state: { reported: { wrong: true } },
    })
    client.emit('status', 'thing-1', 'accepted', client.lastToken(), {
      state: { reported: { right: true } },
    })

    expect(await device.getCurrentState()).toEqual({ right: true })
  })

  it('applies foreign state changes on top of the current state', async () => {
    const client = new FakeMqttClient(),
      device = new IotDevice<any>(deviceInfo(), clientSubject(client))

    connectWithShadow(client, 'thing-1', {
      reported: { current: { playing: 'none', step: 0 } },
    })
    client.emit('foreignStateChange', 'thing-1', 'update', {
      state: { reported: { current: { playing: 'remote' } } },
    })

    expect(await firstValueFrom(device.onState)).toEqual({
      current: { playing: 'remote', step: 0 },
    })
  })

  it('registers the thing once and re-fetches the shadow on reconnect', () => {
    const client = new FakeMqttClient()
    new IotDevice<any>(deviceInfo(), clientSubject(client))

    client.emit('connect')
    client.emit('connect')

    expect(client.register).toHaveBeenCalledTimes(1)
    expect(client.get).toHaveBeenCalledTimes(2)
  })

  it('queues updates until the initial shadow arrives, then sends them in order', async () => {
    const client = new FakeMqttClient(),
      device = new IotDevice<any>(deviceInfo(), clientSubject(client))

    device.update({ a: 1 })
    device.update({ b: 2 })
    await flush()
    expect(client.updates).toEqual([])

    connectWithShadow(client, 'thing-1', { reported: {} })
    await flush()
    expect(client.updates).toEqual([{ state: { desired: { a: 1 } } }])

    ackLastUpdate(client, 'thing-1')
    await flush()
    expect(client.updates).toEqual([
      { state: { desired: { a: 1 } } },
      { state: { desired: { b: 2 } } },
    ])
  })
})
