---
"@schemat/web": patch
---

Follow the system colour scheme with a remembered manual override, and fix the canvas control contrast.

The zoom/fit/lock controls rendered as a white panel with light-grey icons on the dark canvas, which made them hard to read. All colours are now theme tokens, and React Flow's `--xy-*` variables map onto them.
