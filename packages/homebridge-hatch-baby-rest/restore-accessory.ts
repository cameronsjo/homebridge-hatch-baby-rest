import { hap } from '../shared/hap.ts'
import type { PlatformAccessory } from 'homebridge'
import { BaseAccessory } from '../shared/base-accessory.ts'
import { RestIot } from './rest-iot.ts'
import { Restore } from './restore.ts'
import { logInfo } from '../shared/util.ts'
import { firstValueFrom } from 'rxjs'

export class RestoreAccessory extends BaseAccessory {
  private pendingVolume: number | undefined
  private isPlaying = false

  constructor(restore: Restore | RestIot, accessory: PlatformAccessory) {
    super(restore, accessory)

    const { Service, Characteristic } = hap,
      stepName = restore instanceof RestIot ? 'routine' : 'bedtime step'

    // Use Lightbulb for on/off + brightness (volume)
    const lightbulbService = this.getService(Service.Lightbulb)

    // Remove old Switch service if it exists (migration from previous version)
    const oldSwitchService = accessory.getService(Service.Switch)
    if (oldSwitchService) {
      logInfo(`Removing old Switch service for ${restore.name}, migrating to Lightbulb`)
      accessory.removeService(oldSwitchService)
    }

    // Track playing state for volume handling
    restore.onSomeContentPlaying.subscribe((playing) => {
      this.isPlaying = playing
    })

    // On/Off characteristic - controls routine
    this.registerCharacteristic(
      lightbulbService.getCharacteristic(Characteristic.On),
      restore.onSomeContentPlaying,
      (on) => {
        logInfo(
          `Turning ${on ? `on first ${stepName} for` : 'off'} ${restore.name}`,
        )
        if (on) {
          // Pass pending volume when turning on (RestIot only)
          if (restore instanceof RestIot && this.pendingVolume !== undefined) {
            logInfo(`Applying pending volume: ${this.pendingVolume}%`)
            restore.turnOnRoutine(this.pendingVolume)
            this.pendingVolume = undefined
          } else {
            restore.turnOnRoutine()
          }
        } else {
          restore.turnOff()
        }
      },
    )

    // Brightness characteristic - controls volume (RestIot only)
    if (restore instanceof RestIot) {
      this.registerCharacteristic(
        lightbulbService.getCharacteristic(Characteristic.Brightness),
        restore.onVolume,
        (brightness: number) => {
          logInfo(`Volume set to ${brightness}% for ${restore.name} (playing: ${this.isPlaying})`)
          if (this.isPlaying) {
            // Device is on - send volume immediately
            restore.setVolume(brightness)
          } else {
            // Device is off - store for when it turns on
            this.pendingVolume = brightness
            logInfo(`Stored pending volume: ${brightness}%`)
          }
        },
      )
    }

    lightbulbService.setPrimaryService(true)
  }
}
