import {
  IotDeviceInfo,
  Product,
  RestIotRoutine,
  RestIotState,
} from '../shared/hatch-sleep-types.ts'
import { distinctUntilChanged, map } from 'rxjs/operators'
import { BaseDevice } from '../shared/base-accessory.ts'
import { IotDevice } from './iot-device.ts'
import { logInfo, logError, logDebug } from '../shared/util.ts'
import { BehaviorSubject } from 'rxjs'
import { thingShadow as AwsIotDevice } from 'aws-iot-device-sdk'
import { apiPath, RestClient } from './rest-client.ts'

export class RestIot extends IotDevice<RestIotState> implements BaseDevice {
  public readonly info
  public readonly onIotClient
  public readonly restClient

  get model() {
    return this.info.product === Product.restoreIot
      ? 'Restore IoT'
      : Product.riotPlus
        ? 'Rest+ 2nd Gen'
        : 'Rest 2nd Gen'
  }

  constructor(
    info: IotDeviceInfo,
    onIotClient: BehaviorSubject<AwsIotDevice>,
    restClient: RestClient,
  ) {
    super(info, onIotClient)
    this.info = info
    this.onIotClient = onIotClient
    this.restClient = restClient
  }

  onSomeContentPlaying = this.onState.pipe(
    map((state) => state.current.playing !== 'none'),
    distinctUntilChanged(),
  )

  onVolume = this.onState.pipe(
    map((state) => this.volumeFromDevice(state.current.sound.v)),
    distinctUntilChanged(),
  )

  onFirmwareVersion = this.onState.pipe(map((state) => state.deviceInfo.f))

  /**
   * Convert HomeKit percentage (0-100) to device value (0-65535)
   */
  private volumeToDevice(percent: number): number {
    return Math.round(percent * 65535 / 100)
  }

  /**
   * Convert device value (0-65535) to HomeKit percentage (0-100)
   */
  private volumeFromDevice(raw: number): number {
    return Math.round(raw * 100 / 65535)
  }

  private setCurrent(
    playing: RestIotState['current']['playing'],
    step: number,
    srId: number,
    volume?: number,
  ) {
    logInfo(`[RestIot] setCurrent called: playing=${playing}, step=${step}, srId=${srId}, volume=${volume}`)

    const update: any = {
      current: {
        playing,
        step,
        srId,
        paused: false,  // Always unpause when setting state
      },
    }

    if (volume !== undefined) {
      update.current.sound = {
        v: this.volumeToDevice(volume),
      }
    }

    this.update(update)
  }

  /**
   * Set volume while device is playing (live adjustment)
   * @param percent Volume 0-100
   */
  setVolume(percent: number) {
    logInfo(`[RestIot] setVolume called: ${percent}%`)
    this.update({
      current: {
        sound: {
          v: this.volumeToDevice(percent),
        },
      },
    })
  }

  async turnOnRoutine(volume?: number) {
    logInfo(`[RestIot] turnOnRoutine called for ${this.name}${volume !== undefined ? ` at volume ${volume}%` : ''}`)
    try {
      const routines = await this.fetchRoutines()
      logInfo(`[RestIot] Fetched ${routines.length} routines`)
      if (routines.length === 0) {
        logError(`[RestIot] No routines found for ${this.name}! Cannot turn on.`)
        return
      }
      logInfo(`[RestIot] Using routine: id=${routines[0].id}, name=${routines[0].name || 'unnamed'}`)
      this.setCurrent('routine', 1, routines[0].id, volume)
    } catch (e) {
      logError(`[RestIot] Failed to turn on routine: ${e}`)
    }
  }

  turnOff() {
    logInfo(`[RestIot] turnOff called for ${this.name}`)
    this.setCurrent('none', 0, 0)
  }

  async fetchRoutines() {
    logInfo(`[RestIot] Fetching routines for MAC: ${this.info.macAddress}`)
    const routinesPath = apiPath(
        `service/app/routine/v2/fetch?macAddress=${encodeURIComponent(
          this.info.macAddress,
        )}`,
      )
    logDebug(`[RestIot] Routines URL: ${routinesPath}`)

    const allRoutines = await this.restClient.request<RestIotRoutine[]>({
      url: routinesPath,
      method: 'GET',
    })
    logInfo(`[RestIot] Received ${allRoutines.length} total routines`)
    logDebug(`[RestIot] All routines: ${JSON.stringify(allRoutines.map(r => ({ id: r.id, name: r.name, type: r.type, button0: r.button0 })))}`)

    const sortedRoutines = allRoutines.sort(
      (a, b) => a.displayOrder - b.displayOrder,
    )
    const touchRingRoutines = sortedRoutines.filter((routine) => {
      return (
        routine.type === 'favorite' || // Before upgrade, only favorites were on touch ring
        routine.button0 // After upgrade, many routine types can be on touch ring but will have `button0: true`
      )
    })

    logInfo(`[RestIot] Filtered to ${touchRingRoutines.length} touch ring routines`)
    if (touchRingRoutines.length === 0 && allRoutines.length > 0) {
      logError(`[RestIot] WARNING: ${allRoutines.length} routines found but none match touch ring filter!`)
      logInfo(`[RestIot] Routine types: ${allRoutines.map(r => r.type).join(', ')}`)
    }

    return touchRingRoutines
  }
}
