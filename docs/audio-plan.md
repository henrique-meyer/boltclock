# Audio behavior
- **Siren ("wheeoo")**: a rising-falling siren sweep (roughly low→high→low over ~1 s, repeated ~3×). It must be original or public-domain/CC0.
- **Speech**: "Lightning detected {n} miles away" / "{n} kilometers away", n = whole number 0–100+, and "No lightning detected in the area." It must sound clear and consistent on a kiosk device with no internet voice services. If the primary voice method fails, fall back to any other available method rather than staying silent.
- **Chime**: a short pleasant two- or three-tone chime before the all-clear message.
- **Sequencing**: A = siren → short gap → speech. B = chime → speech. Never overlap sounds; a newer event interrupts the current one.
- **Autoplay**: browsers block sound until a user gesture. Provide a large "Start display" action (which also enters full screen) that enables audio. If audio is not enabled, show a persistent "click to enable sound" banner. Document a kiosk configuration that allows sound without a click.
- Volume control and test buttons for A and B in settings.
- Sound sets are built-in and selectable later. No uploads.
