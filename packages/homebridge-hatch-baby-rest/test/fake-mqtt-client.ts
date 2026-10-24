import { EventEmitter } from 'node:events'
import { BehaviorSubject } from 'rxjs'
import { vi } from 'vitest'
import type { thingShadow as AwsIotDevice } from 'aws-iot-device-sdk'
import type { IotDeviceInfo } from '../../shared/hatch-sleep-types.ts'

/**
 * Stand-in for the AWS IoT thingShadow client. Tests drive it by emitting
 * the same events the SDK emits (`connect`, `status`, `foreignStateChange`).
 */
export class FakeMqttClient extends EventEmitter {
  private tokenCount = 0
  readonly updates: any[] = []

  register = vi.fn((_thingName: string, _options: any, cb: () => void) => {
    cb()
  })

  get = vi.fn(() => this.nextToken())

  update = vi.fn((_thingName: string, payload: any) => {
    this.updates.push(payload)
    return this.nextToken()
  })

  lastToken() {
    return `token-${this.tokenCount}`
  }

  private nextToken() {
    this.tokenCount += 1
    return this.lastToken()
  }
}

export function deviceInfo(
  overrides: Partial<IotDeviceInfo> = {},
): IotDeviceInfo {
  return {
    id: 1,
    createDate: '',
    updateDate: '',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    owner: true,
    name: 'Nursery',
    hardwareVersion: '',
    product: 'restoreIot',
    thingName: 'thing-1',
    email: '',
    memberId: 1,
    ...overrides,
  } as IotDeviceInfo
}

export function clientSubject(client: FakeMqttClient) {
  return new BehaviorSubject(client as unknown as AwsIotDevice)
}

/** Connect, register, and answer the initial shadow `get` with `state`. */
export function connectWithShadow(
  client: FakeMqttClient,
  thingName: string,
  state: { reported?: any; desired?: any },
) {
  client.emit('connect')
  client.emit('status', thingName, 'accepted', client.lastToken(), { state })
}

/** Acknowledge the most recent `update` so the next queued one can run. */
export function ackLastUpdate(client: FakeMqttClient, thingName: string) {
  client.emit('status', thingName, 'accepted', client.lastToken(), {
    state: {},
  })
}

export async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}
