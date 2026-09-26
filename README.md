# TV-b-goner

An iPhone-oriented, audio-to-infrared TV power-code sweeper.

It is designed around the hardware already proven with EzRemote:

`iPhone → Lightning-to-3.5 mm adapter → audio-to-IR emitter`

## What it does

- Synthesizes infrared mark/space patterns as 48 kHz audio.
- Supports a **1 LED / mono** mode and a **2 LED / stereo anti-phase** mode.
- Builds a fresh TV power-code database from the MIT-licensed [FlipperDevices IRDB](https://github.com/flipperdevices/IRDB) on every deployment and weekly thereafter.
- Separates **explicit OFF** commands from ordinary **power-toggle** commands.
- Provides separate one-tap sweeps for **explicit OFF-only** commands and **all other power codes**, so the safe subset can be tried independently before any toggle commands.
- Imports additional Flipper `.ir` files directly in the browser.
- Currently transmits raw signals plus parsed NEC, NECext, Samsung32, SIRC, SIRC15 and SIRC20 signals. Unsupported parsed protocols are skipped rather than approximated.

## Reliability improvements

The initial prototype created a new browser audio element for every IR code. That is vulnerable to iPhone/Safari autoplay restrictions after the first user gesture.

The current version instead constructs the entire selected sweep as **one continuous WAV stream** and starts it with the single GO interaction. This also gives deterministic inter-code timing and makes STOP interrupt one stream rather than hundreds of separate play requests.

Sony SIRC decoding now treats Flipper address/command fields as little-endian bytes and emits the normal three-frame repeated command. Automated tests cover this path.

## Code ordering

The database generator sorts candidates **before deduplication**. Identical commands therefore retain a representative from a high-priority modern TV brand when possible, rather than whichever directory happened to be scanned first.

Current priority begins with Samsung, LG, TCL, Hisense, Sony, Vizio, ONN, Roku, Philips, Panasonic, Sharp, Toshiba, Insignia, Fire TV and Amazon. Discrete OFF commands always precede toggle commands.

The browser preserves this database order rather than alphabetizing it again.

## Why the OFF-only mode exists

A classic TV-B-Gone mostly emits power-toggle commands. A toggle can turn an already-off television back on.

This project therefore keeps discrete `Off`, `Power_off`, and `Standby` signals separate. The interface has one button for that conservative OFF-only set and a second button for the remaining power-toggle codes.

## Audio synthesis

The audio path follows the same useful technique used by open-source audio IR transmitters: the requested IR carrier is represented by an audio tone at half the carrier frequency, with mark windows containing the tone and spaces containing silence. Stereo mode drives the two channels in opposite phase.

The implementation was independently written for this project after studying the architecture of [iodn/android-ir-blaster](https://github.com/iodn/android-ir-blaster).

## Database

The deployed database is generated from:

- [flipperdevices/IRDB](https://github.com/flipperdevices/IRDB), MIT licensed.

The generator scans the TV catalog for `Power`, `Power_off`, `Off`, and `Standby` signals, deduplicates them, prioritizes discrete-off commands, and omits protocol formats that this transmitter does not yet encode.

Build statistics now include supported and unsupported counts **by protocol**, so protocol support can be expanded based on the actual missing coverage rather than guesswork.

## Testing and deployment

The GitHub Actions deployment now runs the signal-generation test suite and JavaScript syntax checks before rebuilding the current IR database and deploying GitHub Pages.

Live site:

https://udeudeude.github.io/TV-b-goner/

## Hardware note

Start with **1 LED / mono** and maximum media volume for the small emitter already known to work with EzRemote. The larger unknown IR emitter may require different drive electronics.

## License

Project code: MIT.  
Generated IR database: derived from FlipperDevices IRDB under its MIT license.
