import { RestPlusState, IotDeviceInfo } from '../shared/hatch-sleep-types.ts'
import { thingShadow as AwsIotDevice } from 'aws-iot-device-sdk'
import { BehaviorSubject, firstValueFrom, skip, Subject } from 'rxjs'
import { filter } from 'rxjs/operators'
import { delay, logDebug, logError, logInfo } from '../shared/util.ts'
import { DeepPartial } from 'ts-essentials'

function assignState<T = RestPlusState>(previousState: any, changes: any): T {
  const state = Object.assign({}, previousState)

  for (const key in changes) {
    if (typeof changes[key] === 'object') {
      state[key] = assignState(previousState[key] || {}, changes[key])
    } else {
      state[key] = changes[key]
    }
  }

  return state
}

export const MAX_IOT_VALUE = 65535

export function convertFromPercentage(percentage: number) {
  return Math.ceil((percentage / 100) * MAX_IOT_VALUE)
}

export function convertToPercentage(value: number) {
  return Math.floor((value * 100) / MAX_IOT_VALUE)
}

export class IotDevice<T> {
  private onCurrentState = new BehaviorSubject<T | null>(null)
  private get mqttClient() {
    return this.onIotClient.getValue()
  }
  private onStatusToken = new Subject<string>()
  private previousUpdatePromise: Promise<any> = Promise.resolve()

  onState = this.onCurrentState.pipe(
    filter((state): state is T => state !== null),
  )

  get id() {
    return this.info.id
  }

  get name() {
    return this.info.name
  }

  get macAddress() {
    return this.info.macAddress
  }

  public readonly info
  public readonly onIotClient

  constructor(info: IotDeviceInfo, onIotClient: BehaviorSubject<AwsIotDevice>) {
    this.info = info
    this.onIotClient = onIotClient
    onIotClient
      .pipe(skip(1))
      .subscribe((client) => this.registerMqttClient(client))

    this.registerMqttClient(onIotClient.getValue())
  }

  private registerMqttClient(mqttClient: AwsIotDevice) {
    const { thingName } = this.info
    let getClientToken: string

    logInfo(`[IotDevice] Registering MQTT client for ${this.name} (thingName: ${thingName})`)

    mqttClient.on('close', () => {
      logError(`[IotDevice] MQTT client CLOSED for ${this.name}`)
    })

    mqttClient.on('offline', () => {
      logError(`[IotDevice] MQTT client OFFLINE for ${this.name}`)
    })

    mqttClient.on('error', (error: Error) => {
      logError(`[IotDevice] MQTT ERROR for ${this.name}: ${error.message}`)
    })

    mqttClient.on('reconnect', () => {
      logInfo(`[IotDevice] MQTT reconnecting for ${this.name}`)
    })

    mqttClient.on(
      'status',
      (
        topic,
        message,
        clientToken,
        status: { state: { desired: T; reported: T } },
      ) => {
        logInfo(`[IotDevice] Received shadow status for topic: ${topic}, token: ${clientToken}`)

        if (topic !== thingName) {
          logDebug(`[IotDevice] Ignoring status for different thing: ${topic}`)
          return
        }

        this.onStatusToken.next(clientToken)

        if (clientToken === getClientToken) {
          const { state } = status
          logInfo(`[IotDevice] Initial shadow state received for ${this.name}`)
          logInfo(`[IotDevice] Reported state: ${JSON.stringify(state.reported || 'null')}`)
          logInfo(`[IotDevice] Desired state: ${JSON.stringify(state.desired || 'null')}`)
          this.onCurrentState.next(assignState(state.reported, state.desired))
        } else {
          logDebug(`[IotDevice] Status response for update token: ${clientToken}`)
        }
      },
    )

    mqttClient.on('foreignStateChange', (topic, message, s) => {
      logInfo(`[IotDevice] foreignStateChange received for topic: ${topic}`)
      logDebug(`[IotDevice] foreignStateChange data: ${JSON.stringify(s)}`)

      const currentState = this.onCurrentState.getValue()

      if (!currentState || topic !== thingName) {
        logDebug(`[IotDevice] Ignoring foreignStateChange - currentState: ${!!currentState}, topic match: ${topic === thingName}`)
        return
      }

      logInfo(`[IotDevice] Applying foreign state change for ${this.name}`)
      this.onCurrentState.next(
        assignState(
          assignState(currentState, s.state.reported),
          s.state.desired,
        ),
      )
    })

    ;(mqttClient as any).on('delta', (thingNameDelta: string, stateObject: any, clientToken: string) => {
      logInfo(`[IotDevice] Delta received for ${thingNameDelta}, token: ${clientToken}`)
      logDebug(`[IotDevice] Delta state: ${JSON.stringify(stateObject)}`)
    })

    ;(mqttClient as any).on('timeout', (thingNameTimeout: string, clientToken: string) => {
      logError(`[IotDevice] TIMEOUT for ${thingNameTimeout}, token: ${clientToken}`)
    })

    this.previousUpdatePromise = this.previousUpdatePromise
      .catch((err) => {
        logError(`[IotDevice] Previous update promise error for ${this.name}: ${err}`)
      })
      .then(
        () =>
          new Promise((resolve) => {
            mqttClient.on('connect', () => {
              logInfo(`[IotDevice] MQTT CONNECTED for ${this.name}`)
              mqttClient.register(thingName, {}, () => {
                logInfo(`[IotDevice] MQTT registered for thing: ${thingName}`)
                getClientToken = mqttClient.get(thingName)!
                logDebug(`[IotDevice] Got client token: ${getClientToken}`)
                resolve(
                  firstValueFrom(
                    this.onStatusToken.pipe(
                      filter((token) => token === getClientToken),
                    ),
                  ),
                )
              })
            })
          }),
      )
  }

  getCurrentState() {
    return firstValueFrom(this.onState)
  }

  update(update: DeepPartial<T>) {
    logInfo(`[IotDevice] update() called for ${this.name}: ${JSON.stringify(update)}`)

    this.previousUpdatePromise = this.previousUpdatePromise
      .catch((err) => {
        logError(`[IotDevice] Previous promise error in update chain: ${err}`)
      })
      .then(() => {
        logDebug(`[IotDevice] Executing update for ${this.name}`)

        if (!this.mqttClient) {
          logError(`[IotDevice] CRITICAL: No MQTT Client for ${this.name}! Update cannot be sent.`)
          return
        }

        logInfo(`[IotDevice] Sending MQTT update to thing: ${this.info.thingName}`)
        const updateToken = this.mqttClient.update(this.info.thingName, {
          state: {
            desired: update,
          },
        })

        if (!updateToken) {
          logError(
            `[IotDevice] MQTT update returned no token for ${this.name}. Another update in progress? Payload: ${JSON.stringify(update)}`,
          )
          return
        }

        logInfo(`[IotDevice] MQTT update sent, token: ${updateToken}`)

        const requestComplete = firstValueFrom(
          this.onStatusToken.pipe(filter((token) => token === updateToken)),
        )

        // wait a max of 30 seconds to finish request
        return Promise.race([requestComplete, delay(30000)]).then((result) => {
          if (result === undefined) {
            logError(`[IotDevice] MQTT update TIMED OUT after 30s for ${this.name}`)
          } else {
            logInfo(`[IotDevice] MQTT update completed for ${this.name}`)
          }
          return result
        })
      })
  }
}
