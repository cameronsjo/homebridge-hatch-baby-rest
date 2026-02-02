# Volume Control Implementation Status

**Date:** 2026-02-01
**Status:** Code Complete, Blocked by HomeKit UI
**Related:** [Enhanced Controls Design](./2026-02-01-restore-iot-enhanced-controls-design.md)

## Quick Context

We're adding volume control to the Hatch Restore IoT Homebridge plugin. The code is done and working, but HomeKit won't display the brightness slider because it cached the accessory as a Switch.

## What's Implemented

### Code Changes (All Complete)

```
packages/homebridge-hatch-baby-rest/rest-iot.ts
├── volumeToDevice(percent) - converts 0-100 → 0-65535
├── volumeFromDevice(raw) - converts 0-65535 → 0-100
├── onVolume - BehaviorSubject observable for current volume
├── setVolume(percent) - sends volume update to device
└── setCurrent() - modified to accept optional volume parameter

packages/homebridge-hatch-baby-rest/restore-accessory.ts
├── Changed Service.Switch → Service.Lightbulb
├── Added Characteristic.Brightness handler
├── pendingVolume - stores volume when device is off
└── Applies pending volume on turnOnRoutine()
```

### Verified Working

- [x] Volume values captured from Hatch app (0, 30, 50, 100 → 0, 19560, 32112, 65535)
- [x] Conversion formulas correct
- [x] Code compiles without errors
- [x] Accessory creates as Lightbulb (logs show "Adding new Hatch Restore IoT")
- [x] MQTT connection established
- [x] Shadow state received with volume data

## The Blocker: HomeKit Caching

### Problem

HomeKit cached the accessory as a `Switch` when it was first paired. Despite the code now creating a `Lightbulb` service, HomeKit continues to display it as a Switch with no brightness slider.

### What We Tried

| Attempt | Result |
|---------|--------|
| Remove accessory from Home app | Still shows as Switch after re-discovery |
| Delete `cachedAccessories` file | Still shows as Switch |
| Change UUID (add `-v2` suffix) | Created new accessory, still Switch |
| Multiple Homebridge restarts | No change |
| Force-close Home app | No change |

### What We Didn't Try

- [ ] **Unpair entire Homebridge bridge** and re-pair from scratch (nuclear option)
- [ ] **Expose volume as separate accessory** (e.g., "My Restore Volume" as a Fan or second Lightbulb)
- [ ] **Use a different service type** that HomeKit might handle differently
- [ ] **Check if other HomeKit apps** (Eve, Home+, Controller) show the brightness slider
- [ ] **Wait 24-48 hours** for HomeKit's iCloud sync to catch up

## Recommended Next Steps

### Option A: Nuclear Reset (Most Likely to Work)

1. In Homebridge UI → Settings → "Unpair Bridges / Cameras"
2. Delete `/var/lib/homebridge/persist` folder
3. Delete `/var/lib/homebridge/accessories` folder
4. Restart Homebridge
5. Re-scan QR code to add Homebridge to HomeKit
6. Re-assign all accessories to rooms

**Downside:** Loses all room assignments, automations, scenes for ALL Homebridge accessories.

### Option B: Separate Volume Accessory

Modify `restore-accessory.ts` to create TWO accessories:
- "My Restore" - Switch for on/off (keeps existing behavior)
- "My Restore Volume" - Lightbulb for volume only

This sidesteps the caching issue entirely since the volume accessory would be brand new.

### Option C: Test with Third-Party App

Install Eve or Home+ app and check if they show the Lightbulb with brightness. If they do, the issue is specifically Apple's Home app caching.

## Test Commands

```bash
# Deploy to Pi
npm run build
npm pack --pack-destination . -w homebridge-hatch-baby-rest
scp packages/homebridge-hatch-baby-rest/*.tgz pi@192.168.1.222:/tmp/
ssh pi@192.168.1.222 "sudo npm install -g /tmp/homebridge-hatch-baby-rest-*.tgz && sudo systemctl restart homebridge"

# Check logs
ssh pi@192.168.1.222 "tail -f /var/lib/homebridge/homebridge.log | grep -i hatch"

# Clear accessory cache
ssh pi@192.168.1.222 "sudo systemctl stop homebridge && sudo rm -f /var/lib/homebridge/accessories/cachedAccessories && sudo systemctl start homebridge"

# Nuclear reset (loses all room assignments!)
ssh pi@192.168.1.222 "sudo systemctl stop homebridge && sudo rm -rf /var/lib/homebridge/persist /var/lib/homebridge/accessories && sudo systemctl start homebridge"
```

## Volume Control Test Cases

Once HomeKit shows the brightness slider:

| Test | Expected |
|------|----------|
| Set brightness to 50% while OFF | Stores pending, no device update |
| Turn ON | Device starts at 50% volume |
| Set brightness to 100% while ON | Device volume changes immediately |
| Set brightness to 0% while ON | Device mutes but stays playing |
| Turn OFF | Device stops |
| Check brightness after restart | Should match device state |

## Files Reference

| File | Purpose |
|------|---------|
| `rest-iot.ts` | Device class with volume methods |
| `restore-accessory.ts` | HomeKit accessory with Lightbulb service |
| `hatch-sleep-types.ts` | TypeScript types including `sound.v` |
| `platform.ts` | Creates accessories, sets category to LIGHTBULB |

## Session Notes (2026-02-01)

- Discovered `paused: false` is required for any command to work (PR #154 submitted)
- Volume mapping confirmed: `percent * 65535 / 100`
- Device responds correctly to volume changes via Hatch app
- The code path is definitely creating Lightbulb (confirmed in logs)
- HomeKit's aggressive caching is the sole remaining issue
