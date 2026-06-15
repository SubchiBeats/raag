# 🎵 Raag — Play Indian Instruments

An interactive, mobile-first web app for **playing and learning the instruments of India**, right in your browser. Tap, strum, bow and slide your way through eight iconic instruments — every sound is **synthesised live** with the Web Audio API, so there are no audio files, no downloads, and it works offline.

**▶ Live site: https://subchibeats.github.io/raag/**

---

## What's inside

### Eight playable instruments
| | Instrument | How you play it |
|---|---|---|
| ਤਬਲਾ | **Tabla** | Tap the drum zones for different *bols* (Na, Tin, Ge, Ka…) + a built-in **Teental** trainer |
| ਸਿਤਾਰ | **Sitar** | Tap the frets up the scale of **Raga Yaman**, with sympathetic-string shimmer + chikari strum |
| ਬੰਸਰੀ | **Bansuri** | Press & hold the holes — **drag to glide** between notes like a real flute |
| ਹਾਰਮੋਨੀਅਮ | **Harmonium** | A sargam keyboard with sustained reeds; white = natural notes, dark = komal/teevra |
| ਤਾਨਪੁਰਾ | **Tanpura** | Pluck the four drone strings, or let it auto-cycle |
| ਸੰਤੂਰ | **Santoor** | Strike the string courses for that bright, shimmering cascade |
| ਸਾਰੰਗੀ | **Sarangi** | Press & hold to bow, **drag to glide** — the most vocal of instruments |
| ਢੋਲਕ | **Dholak** | Tap the two heads for crisp treble and booming folk bass |

### Play-along lessons 🎓
Seven guided lessons (Sa Re Ga Ma, Twinkle Twinkle in sargam, Raga Yaman, Bhairavi, a Santoor cascade, Teental and the Kaherva folk groove). **Listen** to a phrase, then **Practice** it — the app lights up the next note/stroke and only advances when you play it correctly.

### Extras
- 🔊 **Volume control** + a global **Tanpura drone** that gently fades in, so you can improvise over a tonic.
- 📖 A **Learn** panel on every instrument with its history, region and how it's really played.
- A warm, festive interface with a rotating mandala backdrop and tactile tap/strum animations.

## Tech
- Vanilla **HTML / CSS / JavaScript** — no frameworks, no build step, no dependencies.
- All audio generated live via the **Web Audio API** (Karplus-Strong plucked strings, synthesised membranes for the drums, sustained reed/flute/bowed voices, just-intonation sargam).
- Fully responsive and touch-first (pointer events, large tap targets), with `prefers-reduced-motion` support.

## Run it locally
It's a static site — just serve the folder:

```bash
python -m http.server 5530
# then open http://localhost:5530
```

(Audio needs a user gesture to start, so tap **“Tap to begin”** first.)

## License
[MIT](LICENSE) © Sahib Singh
