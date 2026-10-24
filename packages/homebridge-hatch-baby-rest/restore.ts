import { RestoreState } from '../shared/hatch-sleep-types.ts'
import { distinctUntilChanged, filter, map } from 'rxjs/operators'
import { BaseDevice } from '../shared/base-accessory.ts'
import { IotDevice } from './iot-device.ts'

export class Restore extends IotDevice<RestoreState> implements BaseDevice {
  readonly model = 'Restore'

  onSomeContentPlaying = this.onState.pipe(
    // A shadow with no reported section can lack `content` until the device reports
    map((state) => state.content?.playing),
    filter((playing) => playing !== undefined),
    map((playing) => playing !== 'none'),
    distinctUntilChanged(),
  )

  onFirmwareVersion = this.onState.pipe(
    map((state) => state.deviceInfo?.f),
    filter((f) => f !== undefined),
  )

  private setContent(
    playing: RestoreState['content']['playing'],
    step: number,
  ) {
    this.update({
      content: {
        playing,
        paused: false,
        offset: 0,
        step,
      },
    })
  }

  turnOnRoutine(step = 1) {
    this.setContent('routine', step)
  }

  turnOff() {
    this.setContent('none', 0)
  }
}
