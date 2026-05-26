# Starship Shock Diamonds — Interactive Physics Lab

> Built live with Grok 4.3, Grok Imagine, and the Grok CLI + GitHub MCP integration.

An educational, self-contained web experience that explains the dramatic Mach diamonds (shock diamonds) visible in the exhaust plume of SpaceX Starship Super Heavy during launch.

## Features

- **Real-time 2D simulator** — Adjust chamber pressure, altitude (km), and nozzle scale. Watch the shock cell pattern respond instantly using the well-known `x ≈ 0.67 × D₀ × √(P₀/Pₐ)` relation + simplified normal-shock temperature jump.
- **Intuitive Altitude slider** — Replaces raw ambient pressure with a realistic standard atmosphere model (0–20 km).
- **Live physics readouts** — First diamond distance, visible diamond count, approximate post-shock ΔT, pressure ratio.
- **Presets** — Starship IFT-2, High Altitude (~12 km), Falcon 9, Max Overexpanded. Active preset is visually highlighted.
- **Pause / Capture** — Pause the animation (great for screenshots) + export current frame as PNG.
- **Persistent state** — Your last settings are remembered across reloads via localStorage.
- **Educational tooltip** — Hover near the first diamond on the canvas for a quick "what am I seeing?" explanation.
- **Custom visuals** — All diagrams and hero images were purpose-generated with Grok Imagine for this project.

## Running Locally

Just open `index.html` in any modern browser (double-click works).

Or serve it properly:

```bash
cd C:\GrokCLI\shockwave-lab
python -m http.server 8080
```

Then visit http://localhost:8080

## Physics Notes

The model is an intentionally simplified 1D representation suitable for education and "what if" exploration. Real rocket plumes are 3D, turbulent, chemically reacting flows. The spacing formula comes from established compressible flow literature (see Wikipedia "Shock diamond" and FYFD references).

## Tech

- Pure static HTML + Tailwind via CDN + custom CSS/JS
- Canvas 2D renderer (no build step)
- Designed following the "Supersonic Industrial Laboratory" aesthetic direction

## Credits

- Physics foundation: Wikipedia Shock diamond article + FYFD
- Visuals: Grok Imagine (xAI)
- Built with: Grok 4.3 + Grok CLI tools + GitHub MCP

---

**This project lives at** `C:\GrokCLI\shockwave-lab\`

Made in one session to demonstrate the power of the Grok CLI environment.
