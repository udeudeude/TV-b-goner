# TV-b-goner

An iPhone-oriented, audio-to-infrared TV power-code sweeper.

It is designed around the hardware already proven with EzRemote:

`iPhone → Lightning-to-3.5 mm adapter → audio-to-IR emitter`

## What it does

- Synthesizes infrared mark/space patterns as 48 kHz audio.
- Defaults to **stereo anti-phase**, the arrangement used by simple two-LED EzRemote-compatible audio-jack transmitters. An adapter-specific mono output is also available.
- Builds a fresh TV power-code database from the MIT-licensed [FlipperDevices IRDB](https://github.com/flipperdevices/IRDB) on every deployment and weekly thereafter.
- Separates **explicit OFF** commands from ordinary **power-toggle** commands.
- Lets you select a TV brand (such as LG) before either sweep. Shared signals retain all brands from the source database, so a brand filter does not lose codes assigned a different representative in the full sweep.
- Provides separate one-tap sweeps for **explicit OFF-only** commands and **all other power codes**, so the safe subset can be tried independently before any toggle commands.
- Keeps the eight most recent transmitted codes visible, with individual **REPLAY** buttons after STOP, to help identify the code that made a TV react.
- Imports additional Flipper `.ir` files directly in the browser.
- Currently transmits raw signals plus parsed NEC, NECext, Samsung32, SIRC, SIRC15 and SIRC20 signals. Unsupported parsed protocols are skipped rather than approximated.

## Reliability improvements

The initial prototype created a new browser audio element for every IR code. That is vulnerable to iPhone/Safari autoplay restrictions after the first user gesture.

The current version instead constructs the entire selected sweep as **one continuous WAV stream** and starts it with the single GO interaction. This also gives deterministic inter-code timing and makes STOP interrupt one stream rather than hundreds of separate play requests.

Sony SIRC decoding now treats Flipper address/command fields as little-endian bytes and emits the normal three-frame repeated command. Automated tests cover this path.

Flipper's NECext command is a full 16-bit value, and Samsung32 transmits its one-byte address twice followed by its command and inverted command. The signal encoders now preserve those wire formats, including for the Samsung discrete OFF command.

## Code ordering

The database generator sorts candidates **before deduplication**. Identical commands retain a representative from a high-priority modern TV brand, plus the brands and model names of their other matches. OFF and toggle classifications are deduplicated separately because the same signal can have different functions on different brands.

Current priority begins with Samsung, LG, TCL, Hisense, Sony, Vizio, ONN, Roku, Philips, Panasonic, Sharp, Toshiba, Insignia, Fire TV and Amazon. Discrete OFF commands always precede toggle commands.

The browser preserves this database order rather than alphabetizing it again.

## Why the OFF-only mode exists

A classic TV-B-Gone mostly emits power-toggle commands. A toggle can turn an already-off television back on.

This project therefore keeps discrete `Off`, `Power_off`, and `Standby` signals separate. The interface has one button for that conservative OFF-only set and a second button for the remaining power-toggle codes.

## Audio synthesis

The audio path follows the technique used by simple two-LED audio-jack IR transmitters: the requested IR carrier is represented by an audio tone at half the carrier frequency, with mark windows containing the tone and spaces containing silence. Stereo mode drives the two channels in opposite phase. The opposing LEDs alternately emit light, restoring the full carrier frequency. A bare single LED driven from the mono output emits only once per audio cycle, so the mono output requires adapter electronics that double the carrier to work with ordinary IR receivers.

An [EzRemote-compatible two-LED wiring example](https://fzware.com/diy-audio-jack-ir-blaster.html) documents the opposite-phase stereo channels and anti-parallel LEDs. The exact wiring inside the user's small emitter has not been verified, so a hardware test is still needed.

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

Start with **stereo anti-phase** and maximum media volume for the small emitter already known to work with EzRemote. The larger unknown IR emitter may require different drive electronics.

## License

Project code: MIT.  
Generated IR database: derived from FlipperDevices IRDB under its MIT license.
