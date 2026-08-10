# Custom artwork (optional)

The game paints its own menu backdrops at load time. If you would rather use
your own images, drop them here and list them in `manifest.json` next to this file. Anything
listed is used instead of the generated art; anything left `null` falls back.
The names below are only a suggestion — the manifest decides.

```json
{
  "loading": "loading.jpg",
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
