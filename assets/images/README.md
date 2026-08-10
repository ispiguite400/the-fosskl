# Custom artwork (optional)

The game paints its own menu backdrops at load time. To use your own images
instead, **just drop them in this folder** with the names in the table below —
`manifest.json` already lists those names as candidates, so there is nothing to
edit. The first candidate that actually exists is used; anything missing falls
back to the generated art.

`.jpg` and `.png` are probed by default for the two backdrops. Any other
file (`.webp`, a different name) works too — just name it in the manifest.

A manifest entry may be a single filename or a list of candidates:

```json
{
  "loading": ["loading.jpg", "loading.png"],
  "menu": "menu.jpg",
  "classes": { "shrine": "class-shrine.jpg" }
}
```

| File | Where it appears |
|---|---|
| `loading.jpg` | Loading screen background |
| `menu.jpg` | Main menu, multiplayer and settings background |
| `class-shrine.jpg` | Samurai panel |
| `class-bamboo.jpg` | Assassin panel |
| `class-temple.jpg` | Guard panel |
| `class-ocean.jpg` | Emperor panel |
| `class-nebula.jpg` | Wizard panel |
| `class-desert.jpg` | Fighter panel |
| `class-snow.jpg` | (spare — map it via `art` in `src/data/gamedata.js`) |
| `class-savanna.jpg` | Warrior panel |
| `class-peaks.jpg` | Sensei panel |
| `class-kingdom.jpg` | Knight panel |
| `class-skyland.jpg` | King panel |

Backdrops look best at 1920×1080 or larger; class panels are tall and narrow,
so around 520×1200 works well.
