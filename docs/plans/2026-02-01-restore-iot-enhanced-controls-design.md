# Hatch Restore IoT Enhanced Controls Design

**Date:** 2026-02-01
**Status:** Approved
**Author:** Cameron Sjo, Claude

## Overview

This document describes the design for adding volume control to the Hatch Restore IoT HomeKit integration, plus comprehensive documentation of the device's shadow state for future feature development.

## Background

### Problem Statement

The existing `homebridge-hatch-baby-rest` plugin exposes the Hatch Restore IoT as a simple on/off switch. Users cannot control volume, light brightness, or other device features from HomeKit.

### Discovery Process

Through debugging a non-responsive device issue, we captured extensive AWS IoT shadow state data and reverse-engineered the device protocol. This document preserves that knowledge for future development.

### Device Information

- **Product Type:** `restoreIot`
- **Firmware Tested:** 9.1.594
- **Communication:** AWS IoT MQTT over WebSocket
- **State Management:** AWS IoT Device Shadow (desired/reported state model)

---

## Phase 1: Volume Control (Current Implementation)

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HomeKit Service | Lightbulb | Best slider support, works in all HomeKit apps, Siri-compatible |
| Volume when off | Remember for next on | Matches Hatch app behavior, no unexpected activation |
| Live adjustment | Immediate | Responsive feel, MQTT handles traffic fine |

### Volume Mapping

The device uses a 16-bit unsigned integer (0-65535) for volume. The Hatch app displays 0-100%.

**Observed values:**

| App Display | Device Value | Calculated |
|-------------|--------------|------------|
| 0 | 0 | 0% |
| 30 | 19560 | 29.85% |
| 50 | 32112 | 49.0% |
| 100 | 65535 | 100% |

**Conversion formulas:**

```typescript
// HomeKit (0-100) → Device (0-65535)
volumeToDevice(percent: number): number {
  return Math.round(percent * 65535 / 100)
}

// Device (0-65535) → HomeKit (0-100)
volumeFromDevice(raw: number): number {
  return Math.round(raw * 100 / 65535)
}
```

### Architecture

```
RestoreAccessory
├── Lightbulb Service (primary)
│   ├── On characteristic → turnOnRoutine() / turnOff()
│   └── Brightness characteristic → setVolume() / getVolume()
│
└── RestIot (device class)
    ├── onVolume: BehaviorSubject<number>  ← NEW: Observable 0-100
    ├── setVolume(percent: number): void   ← NEW: Update volume
    ├── volumeToDevice(percent): number    ← NEW: Conversion helper
    ├── volumeFromDevice(raw): number      ← NEW: Conversion helper
    └── setCurrent(playing, step, srId, volume?)  ← MODIFIED: Optional volume
```

### Data Flow

#### Reading Volume (Device → HomeKit)

```
MQTT foreignStateChange
    ↓
IotDevice.onCurrentState (full shadow)
    ↓
RestIot.onState (typed RestIotState)
    ↓
RestIot.onVolume (mapped to 0-100)
    ↓
RestoreAccessory updates Characteristic.Brightness
```

#### Writing Volume (HomeKit → Device)

```
User adjusts brightness slider
    ↓
RestoreAccessory.setBrightness(value)
    ↓
┌─ If device ON:
│      RestIot.setVolume(value)
│          ↓
│      IotDevice.update({ current: { sound: { v: deviceValue }}})
│
└─ If device OFF:
       Store in pendingVolume
       Applied on next turnOnRoutine()
```

### Files to Modify

| File | Changes |
|------|---------|
| `packages/homebridge-hatch-baby-rest/rest-iot.ts` | Add `onVolume`, `setVolume()`, conversion helpers, update `setCurrent()` |
| `packages/homebridge-hatch-baby-rest/restore-accessory.ts` | Change Switch → Lightbulb, add Brightness handling, `pendingVolume` state |

### Modified `setCurrent()` Implementation

```typescript
private setCurrent(
  playing: RestIotState['current']['playing'],
  step: number,
  srId: number,
  volume?: number
) {
  const update: DeepPartial<RestIotState> = {
    current: {
      playing,
      step,
      srId,
      paused: false,
    },
  }

  if (volume !== undefined) {
    update.current!.sound = {
      v: this.volumeToDevice(volume),
    }
  }

  this.update(update)
}
```

### Edge Cases

| Case | Handling |
|------|----------|
| Unknown state at startup | Read initial volume from shadow before exposing to HomeKit |
| Volume set while off | Store in `pendingVolume`, apply on `turnOnRoutine()`, clear after |
| Routine has no sound | Volume changes ignored; device will discard `sound.v` |
| Rapid slider movements | Each sends immediately; last value wins |
| Volume at 0 | Treated as muted but still "on" if routine is playing |

---

## Future Features (YAGNI - Documented for Later)

The following features are NOT being implemented now but are fully documented to avoid re-reverse-engineering.

### Sound Selection

**Shadow State Fields:**

```json
{
  "current": {
    "sound": {
      "id": 10054,
      "v": 32112,
      "mute": false,
      "url": "https://assets.ctfassets.net/hlsdh3zwyrtx/.../Calm_Ocean_20191220.wav",
      "duration": 0,
      "until": "indefinite"
    }
  }
}
```

**Known Sound IDs:**

| ID | Sound | Notes |
|----|-------|-------|
| 10054 | Calm Ocean | Observed in testing |
| 19998 | No Sound | `url: "https://images.hatchbaby.com/content/sounds/noSound.wav"` |

**Implementation Notes:**

- Sound selection would require fetching available sounds from Hatch API
- HomeKit has no native "input source" for accessories; would need creative UI
- Could use InputSource service (like TV inputs) but complex
- Alternative: Multiple switches, one per favorite sound

**API Endpoint for Sounds:**
```
GET https://prod-sleep.hatchbaby.com/service/app/routine/v2/fetch?macAddress={MAC}
```

Returns routines which contain sound definitions.

---

### Light Color Control

**Shadow State Fields:**

```json
{
  "current": {
    "color": {
      "id": 9998,
      "r": 0,
      "g": 0,
      "b": 0,
      "w": 0,
      "i": 16384,
      "duration": 0,
      "until": "indefinite"
    }
  }
}
```

**Field Definitions:**

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `id` | number | varies | Color preset ID (9998 = off/black) |
| `r` | number | 0-65535 | Red channel (16-bit) |
| `g` | number | 0-65535 | Green channel (16-bit) |
| `b` | number | 0-65535 | Blue channel (16-bit) |
| `w` | number | 0-65535 | White channel (16-bit) |
| `i` | number | 0-65535 | Intensity/brightness (16-bit) |
| `duration` | number | seconds | 0 = indefinite |
| `until` | string | "indefinite" | When to stop |

**Conversion (same pattern as volume):**

```typescript
// 0-100 → 0-65535
colorToDevice(percent: number): number {
  return Math.round(percent * 65535 / 100)
}
```

**Implementation Notes:**

- Could expose as ColorLightbulb service with Hue/Saturation/Brightness
- RGB → HSB conversion needed
- The `w` (white) channel complicates things; may need separate white temp control
- The `i` (intensity) is overall brightness, separate from RGB values
- Consider: Separate Lightbulb service just for the light (not combined with sound)

**HomeKit Services:**

```
Option A: Single Lightbulb with color
- On/Off: light on/off
- Brightness: intensity (i)
- Hue/Saturation: derived from RGB

Option B: Separate from sound control
- Switch for routine (sound)
- Lightbulb for light (independent control)
```

---

### Nightlight Control

**Shadow State Fields:**

```json
{
  "nightlightOn": false,
  "nightlightIntensity": 32780,
  "nightlightColor": {
    "r": 0,
    "g": 0,
    "b": 0,
    "w": 65535,
    "id": 0
  }
}
```

**Description:**

The nightlight is a SEPARATE feature from the routine light. It can be on while the routine is off (or vice versa).

**Implementation Notes:**

- Simple on/off switch for `nightlightOn`
- Brightness slider for `nightlightIntensity` (same 0-65535 mapping)
- Color control via `nightlightColor` (same RGB pattern)
- Could be a separate Lightbulb accessory: "Restore Nightlight"

**Recommended HomeKit Structure:**

```
RestoreAccessory (Lightbulb)
├── On: routine on/off
├── Brightness: volume
│
NightlightAccessory (Lightbulb) ← Separate accessory
├── On: nightlightOn
├── Brightness: nightlightIntensity
└── Hue/Saturation: nightlightColor RGB
```

---

### Clock Display Control

**Shadow State Fields:**

```json
{
  "clock": {
    "i": 20971,
    "turnOffAt": "22:00:00",
    "turnOnAt": "07:00:00",
    "turnDimAt": "22:00:00",
    "turnBrightAt": "07:00:00",
    "flags": 32768,
    "turnOffMode": "never"
  }
}
```

**Field Definitions:**

| Field | Description |
|-------|-------------|
| `i` | Clock display brightness (0-65535) |
| `turnOffAt` | Time to turn off clock display |
| `turnOnAt` | Time to turn on clock display |
| `turnDimAt` | Time to dim clock |
| `turnBrightAt` | Time to brighten clock |
| `flags` | Unknown bitfield (32768 observed) |
| `turnOffMode` | "never" or schedule mode |

**Implementation Notes:**

- Could expose clock brightness as a Lightbulb
- Schedule times would need custom UI (not HomeKit native)
- Lower priority feature

---

### Mute Toggle

**Shadow State Fields:**

```json
{
  "current": {
    "sound": {
      "mute": false
    }
  }
}
```

**Implementation Notes:**

- Simple boolean toggle
- Redundant with volume=0 for most use cases
- Could be a separate Switch if needed
- NOT implementing because volume slider at 0% achieves same result

---

### Toddler Lock

**Shadow State Fields:**

```json
{
  "toddlerLockOn": false,
  "toddlerLock": {
    "turnOffAt": "00:00:00",
    "turnOnAt": "00:00:00",
    "turnOnMode": "never"
  }
}
```

**Implementation Notes:**

- Simple on/off for `toddlerLockOn`
- Could be a Switch accessory
- Schedule support would need custom handling

---

### Alarms

**API Endpoint:**
```
GET https://prod-sleep.hatchbaby.com/service/app/routine/v2/fetch?macAddress={MAC}
```

**Response includes alarm routines:**

```json
{
  "id": 112492528,
  "name": "Alarm (RestoreIOT)",
  "type": "alarm",
  "button0": false
}
```

**Implementation Notes:**

- Alarms are routines with `type: "alarm"`
- Could expose as switches to enable/disable
- Triggering alarms would use same `setCurrent()` pattern with alarm's `srId`

---

## Complete Shadow State Reference

This is a complete captured shadow state for reference:

```json
{
  "reported": {
    "env": "prod",
    "alarmsDisabled": false,
    "nightlightOn": false,
    "nightlightIntensity": 32780,
    "toddlerLockOn": false,
    "snoozeDuration": 540,
    "current": {
      "srId": 119102433,
      "playing": "routine",
      "step": 1,
      "paused": true,
      "color": {
        "id": 9998,
        "r": 0,
        "g": 0,
        "b": 0,
        "w": 0,
        "i": 16384,
        "duration": 0,
        "until": "indefinite"
      },
      "sound": {
        "id": 10054,
        "v": 20315,
        "mute": false,
        "url": "https://assets.ctfassets.net/.../Calm_Ocean_20191220.wav",
        "duration": 0,
        "until": "indefinite"
      }
    },
    "dataVersion": "20251217122410309",
    "sleepScene": {
      "srId": 0,
      "enabled": false
    },
    "timer": {
      "s": "2025-08-05 21:47:42",
      "d": 0
    },
    "streaming": {
      "status": "none"
    },
    "timezone": "America/Chicago",
    "rF": {
      "v": "9.1.594",
      "i": true,
      "u": "https://firmware.hatchbaby.com/prod/restoreIot/restoreIot_DFU_9_1_594.bin?f=g"
    },
    "deviceInfo": {
      "f": "9.1.594",
      "fR": 0,
      "hwVersion": "5.133.67",
      "powerStatus": 0,
      "sdCardVersionInfo": {
        "releaseDate": "12-03-2020",
        "hashType": "md5",
        "hashCode": "0x499df452a0213c8b9561c75eab197205"
      }
    },
    "clock": {
      "i": 20971,
      "turnOffAt": "22:00:00",
      "turnOnAt": "07:00:00",
      "turnDimAt": "22:00:00",
      "turnBrightAt": "07:00:00",
      "flags": 32768,
      "turnOffMode": "never"
    },
    "toddlerLock": {
      "turnOffAt": "00:00:00",
      "turnOnAt": "00:00:00",
      "turnOnMode": "never"
    },
    "lucky": 0,
    "LDR": "RECV_FAIL",
    "LWTP": false,
    "debug": 0,
    "logging": 53,
    "owned": true,
    "lastReset": "ResetButt_OtherWDT",
    "ota": {
      "status": "none",
      "downloadProgress": 0,
      "installProgress": 0
    },
    "REX": {
      "lock": 892653021,
      "key": 2346668880,
      "command": "TNL",
      "auth": 2700634952
    },
    "connected": true,
    "rssi": -42,
    "knockThreshold": 20,
    "knockDuration": 0,
    "activeTap": true,
    "knockAxis": 1,
    "snooze": {
      "active": false,
      "startTime": ""
    },
    "hwDebugFlags": 0,
    "touch": {
      "flags": 0,
      "poll_rate_hz": 0,
      "refire_delay_ms": 0,
      "refire_rate_hz": 0,
      "step_size": 0
    },
    "nightlightColor": {
      "r": 0,
      "g": 0,
      "b": 0,
      "w": 65535,
      "id": 0
    }
  },
  "desired": {
    "owned": true,
    "timezone": "America/Chicago",
    "env": "prod",
    "logging": 53,
    "clock": {
      "flags": 32768,
      "i": 20971,
      "turnOffMode": "never",
      "turnOffAt": "22:00:00",
      "turnOnAt": "07:00:00"
    },
    "current": {
      "color": {
        "i": 16384,
        "id": 9998,
        "r": 0,
        "g": 0,
        "b": 0,
        "w": 0,
        "duration": 0,
        "until": "indefinite"
      },
      "sound": {
        "v": 20315,
        "id": 10054,
        "mute": false,
        "url": "https://assets.ctfassets.net/.../Calm_Ocean_20191220.wav",
        "duration": 0,
        "until": "indefinite"
      },
      "srId": 119102433,
      "playing": "routine",
      "step": 1
    },
    "nightlightOn": false,
    "snoozeDuration": 540,
    "sleepScene": {
      "enabled": false
    },
    "timer": {
      "s": "2025-08-05 21:47:42",
      "d": 0
    },
    "rF": {
      "i": true,
      "u": "https://firmware.hatchbaby.com/prod/restoreIot/restoreIot_DFU_9_1_594.bin?f=g",
      "v": "9.1.594"
    },
    "LWTP": false,
    "REX": {
      "key": 2346668880,
      "command": "TNL"
    },
    "nightlightIntensity": 32780
  }
}
```

---

## API Reference

### Authentication

1. Login: `POST https://prod-sleep.hatchbaby.com/public/v1/login`
2. Returns JWT token for subsequent requests
3. Token used to get AWS IoT credentials

### AWS IoT Connection

1. Fetch IoT token: `GET https://prod-sleep.hatchbaby.com/service/app/restPlus/token/v1/fetch`
2. Exchange for AWS Cognito credentials
3. Connect to MQTT via WebSocket: `wss://{endpoint}`
4. Register for device shadow: `thingName: {MAC}-restoreIot`

### Device Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/service/app/iotDevice/v2/fetch?iotProducts=...` | GET | List devices |
| `/service/app/v2/member` | GET | Get member/account info |
| `/service/app/routine/v2/fetch?macAddress={MAC}` | GET | Get routines for device |
| `/service/app/restPlus/token/v1/fetch` | GET | Get IoT token |

### MQTT Topics

| Topic Pattern | Description |
|---------------|-------------|
| `$aws/things/{thingName}/shadow/update` | Send state updates |
| `$aws/things/{thingName}/shadow/update/accepted` | Update confirmations |
| `$aws/things/{thingName}/shadow/update/delta` | State deltas |
| `$aws/things/{thingName}/shadow/get` | Request current state |

---

## Critical Bug Fix (Prerequisite)

Before this feature work, the following bug was fixed:

**Issue:** Device ignores commands when `paused: true` in shadow state.

**Fix:** Always include `paused: false` in `setCurrent()` calls.

**PR:** https://github.com/dgreif/homebridge-hatch-baby-rest/pull/154

This fix is required for volume control (and all other features) to work.

---

## Implementation Checklist

### Phase 1: Volume Control

- [ ] Add `volumeToDevice()` and `volumeFromDevice()` to `rest-iot.ts`
- [ ] Add `onVolume` BehaviorSubject to `RestIot`
- [ ] Add `setVolume(percent: number)` method to `RestIot`
- [ ] Modify `setCurrent()` to accept optional volume parameter
- [ ] Change `RestoreAccessory` from Switch to Lightbulb service
- [ ] Add Brightness characteristic handler
- [ ] Implement `pendingVolume` for offline volume changes
- [ ] Test: Volume at 0, 50, 100
- [ ] Test: Volume change while playing
- [ ] Test: Volume set while off, then turn on
- [ ] Update README with new functionality

### Future Phases (Not Scheduled)

- [ ] Phase 2: Nightlight control (separate Lightbulb accessory)
- [ ] Phase 3: Routine light color control
- [ ] Phase 4: Clock brightness
- [ ] Phase 5: Sound selection (requires UI design work)

---

## Appendix: Routine Response Example

```json
[
  {
    "id": 119102433,
    "name": "Sleep Routine",
    "type": "routine",
    "button0": true,
    "displayOrder": 0
  },
  {
    "id": 112492528,
    "name": "Alarm (RestoreIOT)",
    "type": "alarm",
    "button0": false,
    "displayOrder": 1
  }
]
```

- `button0: true` means the routine is on the touch ring
- `type: "routine"` vs `type: "alarm"` vs `type: "favorite"`
- `displayOrder` determines sort order

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-01 | Cameron Sjo, Claude | Initial design document |
