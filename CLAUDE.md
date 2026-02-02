# Claude Code Instructions for Hatch Homebridge

## Project Overview

This is a fork of [dgreif/homebridge-hatch-baby-rest](https://github.com/dgreif/homebridge-hatch-baby-rest) - a Homebridge plugin for Hatch Rest/Restore sound machines.

**Primary focus:** Enhanced Hatch Restore IoT support with volume control and improved debugging.

## Repository Structure

```
packages/
├── homebridge-hatch-baby-rest/   # Main plugin (WiFi devices)
│   ├── api.ts                    # Hatch API client, AWS IoT setup
│   ├── iot-device.ts             # Base MQTT/shadow device class
│   ├── rest-iot.ts               # Restore IoT device (volume, routines)
│   ├── restore-accessory.ts      # HomeKit accessory (Lightbulb service)
│   └── rest-client.ts            # HTTP client for Hatch REST API
├── homebridge-hatch-rest-bluetooth/  # Bluetooth plugin (not our focus)
└── shared/                       # Shared types and utilities
    ├── hatch-sleep-types.ts      # TypeScript interfaces for device state
    └── util.ts                   # Logging utilities
docs/
└── plans/
    └── 2026-02-01-restore-iot-enhanced-controls-design.md  # IMPORTANT: Full shadow state reference
```

## Key Technical Details

### Device Communication

- **Authentication:** Hatch REST API → JWT token
- **Device Control:** AWS IoT MQTT over WebSocket
- **State Model:** AWS IoT Device Shadow (desired/reported)

### Critical Bug Fix

The Restore IoT ignores commands unless `paused: false` is included in shadow updates. Always include this field in `setCurrent()` calls.

### Volume Mapping

```typescript
// HomeKit (0-100) ↔ Device (0-65535)
volumeToDevice(percent) = Math.round(percent * 65535 / 100)
volumeFromDevice(raw) = Math.round(raw * 100 / 65535)
```

## Development Workflow

### Build

```bash
npm run build          # Build all packages
npm run lint           # Run linter
```

### Deploy to Test Pi

```bash
# Package and deploy
npm pack --pack-destination . -w homebridge-hatch-baby-rest
scp packages/homebridge-hatch-baby-rest/homebridge-hatch-baby-rest-*.tgz pi@192.168.1.222:/tmp/
ssh pi@192.168.1.222 "sudo npm install -g /tmp/homebridge-hatch-baby-rest-*.tgz && sudo systemctl restart homebridge"

# Check logs
ssh pi@192.168.1.222 "tail -f /var/lib/homebridge/homebridge.log | grep -i hatch"
```

### HomeKit Accessory Type Changes

If changing service types (e.g., Switch → Lightbulb), HomeKit aggressively caches. To force refresh:

1. Remove accessory from Home app (long-press → Settings → Remove)
2. Or clear Homebridge cache: `sudo rm /var/lib/homebridge/accessories/cachedAccessories`
3. Restart Homebridge

## Design Documents

**ALWAYS read the design doc before implementing new features:**
- [Enhanced Controls Design](./docs/plans/2026-02-01-restore-iot-enhanced-controls-design.md)

Contains:
- Complete AWS IoT shadow state dump
- Volume, color, nightlight, clock field mappings
- API endpoints and MQTT topics
- Future feature implementation notes

## Git Workflow

- **origin:** cameronsjo/homebridge-hatch-baby-rest (this fork)
- **upstream:** dgreif/homebridge-hatch-baby-rest (original)

```bash
# Sync with upstream
git fetch upstream
git merge upstream/main

# Submit fix upstream
git checkout -b fix/some-fix
# make changes
git push origin fix/some-fix
gh pr create --repo dgreif/homebridge-hatch-baby-rest
```

## Testing Checklist

Before deploying changes:

- [ ] `npm run build` passes
- [ ] Test on/off toggle
- [ ] Test volume slider (if applicable)
- [ ] Check logs for errors
- [ ] Verify HomeKit state syncs with device

## Common Issues

| Issue | Solution |
|-------|----------|
| Device doesn't respond | Check `paused: false` is being sent |
| 429 rate limit | Wait 60 seconds between API calls |
| Accessory type wrong in HomeKit | Clear accessory cache, remove from Home app |
| MQTT disconnects | Check AWS credentials refresh (8-hour cycle) |

## Known Issue: HomeKit Caches Accessory Type

**Status:** Unresolved - HomeKit stubbornly shows Switch even after code changes to Lightbulb.

The code correctly creates a `Service.Lightbulb` with brightness control, but HomeKit caches the original accessory type and won't update it. Tried:
- Removing accessory from Home app
- Clearing `cachedAccessories` file
- Changing UUID to force new accessory
- Multiple Homebridge restarts

None of these reliably force HomeKit to recognize the type change. The volume control code works - this is purely a HomeKit UI issue. May require completely unpairing the Homebridge bridge and re-pairing from scratch.

**Pin for later:** Investigate if there's a way to force HomeKit to refresh accessory metadata, or if we need to use a different approach (separate accessory for volume?).
