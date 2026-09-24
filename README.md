# TV-b-goner

An iPhone-oriented, audio-to-infrared TV power-code sweeper.

It is designed around the hardware already proven with EzRemote:

`iPhone → Lightning-to-3.5 mm adapter → audio-to-IR emitter`

## What it does

- Synthesizes infrared mark/space patterns as 48 kHz, 16-bit-equivalent audio.
- Supports a **1 LED / mono** mode and a **2 LED / stereo anti-phase** mode.
- Builds a fresh TV power-code database from the MIT-licensed [FlipperDevices IRDB](https://github.com/flipperdevices/IRDB) on every deployment and weekly thereafter.
- Separates **explicit OFF** commands from ordinary **power-toggle** commands.
- Imports additional Flipper `.ir` files directly in the browser.
- Currently transmits raw signals plus parsed NEC, NECext, Samsung32, SIRC, SIRC15 and SIRC20 signals. Unsupported parsed protocols are skipped rather than approximated.

## Why the OFF-only mode exists

A classic TV-B-Gone mostly emits power-toggle commands. A toggle can turn an already-off television back on.

This project therefore keeps discrete `Off`, `Power_off`, and `Standby` signals separate. **Explicit OFF only** is the conservative sweep. **All power codes** also sends toggle codes for wider compatibility.

## Audio synthesis

The audio path follows the same useful trick used by open-source audio IR transmitters: the requested IR carrier is represented by an audio tone at half the carrier frequency, with mark windows containing the tone and spaces containing silence. Stereo mode drives the two channels in opposite phase.

The implementation was independently written for this project after studying the architecture of [iodn/android-ir-blaster](https://github.com/iodn/android-ir-blaster).

## Database

The deployed database is generated from:

- [flipperdevices/IRDB](https://github.com/flipperdevices/IRDB), MIT licensed.

The generator scans the TV catalog for `Power`, `Power_off`, `Off`, and `Standby` signals, deduplicates them, prioritizes discrete-off commands, and omits protocol formats that this transmitter does not yet encode.

## Deployment

GitHub Actions builds and deploys the site to GitHub Pages on every push to `main`, and rebuilds the IR database every Monday.

Expected Pages URL:

https://udeudeude.github.io/TV-b-goner/

## Hardware note

Start with **1 LED / mono** and maximum media volume for the small emitter already known to work with EzRemote. The larger unknown IR emitter may require different drive electronics.

## License

Project code: MIT.  
Generated IR database: derived from FlipperDevices IRDB under its MIT license.
