# Hatch Homebridge Plugins (Fork)

> **This is a fork of [dgreif/homebridge-hatch-baby-rest](https://github.com/dgreif/homebridge-hatch-baby-rest) with enhanced Restore IoT support.**

[![Actions Status](https://github.com/dgreif/homebridge-hatch-baby-rest/workflows/Node%20CI/badge.svg)](https://github.com/dgreif/homebridge-hatch-baby-rest/actions)

This repo contains unofficial homebridge plugins for the Hatch Rest/Restore line of sound machines.

## Fork Enhancements

This fork adds the following improvements for **Hatch Restore IoT** devices:

### Volume Control via HomeKit

The Restore IoT is exposed as a **Lightbulb** instead of a Switch, enabling:
- **On/Off** - Starts/stops the bedtime routine
- **Brightness slider** - Controls volume (0-100%)

Volume changes while the device is off are stored and applied when turned on.

### Bug Fix: paused:false

Fixed a critical bug where the device would ignore commands because the `paused` field wasn't being set. This fix has been [submitted upstream](https://github.com/dgreif/homebridge-hatch-baby-rest/pull/154).

### Enhanced Debug Logging

Comprehensive logging throughout the MQTT and API flow for troubleshooting.

## Documentation

- [Enhanced Controls Design Doc](./docs/plans/2026-02-01-restore-iot-enhanced-controls-design.md) - Full shadow state reference and future feature plans

---

## `homebridge-hatch-baby-rest`

The [`homebridge-hatch-baby-rest` plugin](./packages/homebridge-hatch-baby-rest) supports all Wifi models from the [Hatch Rest/Restore lines](https://www.hatch.co/)

## `homebridge-hatch-rest-bluetooth`

The [`homebridge-hatch-rest-bluetooth` plugin](./packages/homebridge-hatch-rest-bluetooth) supports the original [Bluetooth Rest sound machine](https://www.hatch.co/rest)
