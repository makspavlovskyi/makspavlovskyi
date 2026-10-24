"""Builds README.md and its SVG assets (banner, buttons, project cards).

Run from anywhere: python scripts/build_readme.py
Layout and colours come from profile.config.json; PROFILE_LAYOUT=<name> overrides the layout.
Brand icon paths in scripts/icons.json are from simple-icons (CC0)."""
import json, html, os, textwrap

S = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(S)
ICONS = json.load(open(f"{S}/icons.json"))
SANS = "-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,&quot;Noto Sans&quot;,Helvetica,Arial,sans-serif"

THEME = {
    "light": dict(bg="#ffffff", soft="#f6f8fa", border="#d0d7de", fg="#1f2328", muted="#59636e", link="#0969da"),
    "dark":  dict(bg="#0d1117", soft="#161b22", border="#30363d", fg="#e6edf3", muted="#9198a1", link="#4493f8"),
}

# 24x24 line icons (own drawings) for the non-brand links
LINE = {
    "globe": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
    "pen":   '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    "mail":  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
    "repo":  '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6"/>',
}


# Theme: colours + background layout come from profile.config.json, so switching layout is one word.
# scripts/update-profile.mjs implements the same layouts for the cards it draws.
import json, math
CFG = json.load(open(f"{R}/profile.config.json"))
LAYOUT = os.environ.get("PROFILE_LAYOUT", CFG["layout"])
PAL = CFG["palettes"][os.environ.get("PROFILE_PALETTE", CFG["palette"])]
COPPER, TEAL = PAL["colors"]          # first and second colour of the palette
ACCENT = PAL.get("accent", COPPER)    # tiles, prompt and cursor
ALWAYS_DARK = PAL.get("always_dark", False)
def EFF(mode): return "dark" if ALWAYS_DARK else mode   # banner and cards stay dark on GitHub's light theme
def mix(a, b, t):
    a = tuple(int(a[i:i+2], 16) for i in (1, 3, 5)); b = tuple(int(b[i:i+2], 16) for i in (1, 3, 5))
    return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))
BASE = {"light": "#ffffff", "dark": PAL.get("dark", {}).get("base", "#0d1117")}
THEME["dark"] = {**THEME["dark"], **{k: v for k, v in PAL.get("dark", {}).items() if k in THEME["dark"]}, "bg": BASE["dark"]}

def tones(mode):
    mode = EFF(mode)
    if mode == "light":
        return COPPER, TEAL
    return mix(COPPER, "#ffffff", .12), mix(TEAL, "#ffffff", .12)

def lcg(seed):  # tiny deterministic RNG, mirrored in update-profile.mjs
    s = seed
    def rnd():
        nonlocal s
        s = (s * 1103515245 + 12345) % 2147483648
        return s / 2147483648
    return rnd

def pattern(layout, w, h, mode, big):
    """Inner artwork for one layout; returns (defs, body)."""
    mode = EFF(mode)
    ea, eb = tones(mode); base = BASE[mode]
    if layout in ("starlines", "starlines_bright", "starlines_glow"):
        strong = layout != "starlines"
        # original variant on the banner: burst sits in the free space between the text and the tiles
        cx, cy = (w * .6 if (big and not strong) else w * .82), h * .5; rnd = lcg(1241); out = ""
        n, op, sw, reach = (160, .85, 1.2, .6) if strong else (120, .5, .8, .5)
        ca = mix(ea, "#ffffff", .25) if strong and mode == "dark" else ea
        for _ in range(n):
            ang = rnd() * 2 * math.pi; ln = min(h, 200) * (.12 + rnd() * reach); c = ca if rnd() < .5 else eb
            out += f'<line x1="{cx:.1f}" y1="{cy:.1f}" x2="{cx + math.cos(ang)*ln:.1f}" y2="{cy + math.sin(ang)*ln:.1f}" stroke="{c}" stroke-opacity="{op}" stroke-width="{sw}" stroke-linecap="round"/>'
        if not strong:
            return "", out
        hh = min(h, 200)
        defs = (f'<radialGradient id="core" cx="{cx/w:.3f}" cy=".5" r="{hh*.45/w:.3f}" gradientTransform="translate({cx/w:.3f} .5) scale(1 {w/h:.3f}) translate(-{cx/w:.3f} -.5)">'
                f'<stop offset="0" stop-color="{ca}" stop-opacity=".55"/><stop offset="1" stop-color="{ca}" stop-opacity="0"/></radialGradient>')
        if layout == "starlines_glow":
            defs += (f'<filter id="sg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{hh*.012:.1f}" result="b"/>'
                     f'<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
            out = f'<g filter="url(#sg)">{out}</g>'
        return defs, (f'<rect width="{w}" height="{h}" fill="url(#core)"/>' + out
                      + f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{hh*.03:.1f}" fill="#ffffff" fill-opacity=".9"/>')
    if layout == "marble":
        fx, fy = (.006, .012) if w > 500 else (.012, .02)
        return ((f'<linearGradient id="lq" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{ea}"/><stop offset=".5" stop-color="{base}"/><stop offset="1" stop-color="{eb}"/></linearGradient>'
                 f'<filter id="lf" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="{fx} {fy}" numOctaves="3" seed="4"/>'
                 f'<feDisplacementMap in="SourceGraphic" scale="{min(h, 200)*.9:.0f}" xChannelSelector="R" yChannelSelector="G"/></filter>'),
                f'<rect x="{-w*.2:.0f}" y="{-h*.7:.0f}" width="{w*1.4:.0f}" height="{h*2.4:.0f}" fill="url(#lq)" fill-opacity=".75" filter="url(#lf)"/>')
    if layout == "stripes":
        a = mix(COPPER, "#ffffff", .62) if mode == "light" else mix(COPPER, base, .35)
        b = mix(TEAL, "#ffffff", .62) if mode == "light" else mix(TEAL, base, .35)
        hh = min(h, 200)
        bands = "".join(f'<rect x="{x:.1f}" y="{-h}" width="{w*.06:.0f}" height="{h*3}" transform="rotate(28 {x:.1f} {h/2})" fill="url(#st)" fill-opacity="{(.55 - i*.07)*(1 if big else .7):.2f}"/>'
                        for i, x in enumerate([w*.58, w*.68, w*.77, w*.85, w*.92]))
        return (f'<linearGradient id="st" x1="0" x2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'
                f'<filter id="sb"><feGaussianBlur stdDeviation="{hh*.04:.0f}"/></filter>'), f'<g filter="url(#sb)">{bands}</g>'
    if layout == "topographic":
        cx, cy = w * .8, h * .55; hh = min(h, 200); out = ""
        for i in range(1, 14):
            rr = i * max(w, hh) * .045
            pts = []
            for k in range(48):
                tt = k / 48 * 2 * math.pi; j = 1 + .12 * math.sin(3 * tt + i * .7) + .06 * math.sin(5 * tt - i)
                pts.append(f"{cx + math.cos(tt) * rr * j * 1.5:.1f},{cy + math.sin(tt) * rr * j:.1f}")
            out += f'<polygon points="{" ".join(pts)}" fill="none" stroke="{ea if i % 2 else eb}" stroke-opacity="{.55 - i*.03:.2f}" stroke-width="1"/>'
        return "", out
    raise ValueError(f"unknown layout {layout}")

def surface(w, h, mode, strength=0.55, rx=10):
    mode = EFF(mode)
    ea, eb = tones(mode); base = BASE[mode]; big = strength >= 1   # full strength only on the banner
    lo, mid, hi = (.12, .55, 1) if big else ((.06, .3, .65) if LAYOUT in ("starlines_bright", "starlines_glow") else (.05, .18, .42))
    pdefs, body = pattern(LAYOUT, w, h, mode, big)
    return (f'<defs>{pdefs}<linearGradient id="fd" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="{lo}"/><stop offset=".45" stop-color="#fff" stop-opacity="{mid}"/><stop offset=".7" stop-color="#fff" stop-opacity="{hi}"/></linearGradient>'
            f'<mask id="fm"><rect width="{w}" height="{h}" fill="url(#fd)"/></mask>'
            f'<clipPath id="clip"><rect x="1" y="1" width="{w-2}" height="{h-2}" rx="{rx}"/></clipPath>'
            f'<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{ea}" stop-opacity=".55"/><stop offset="1" stop-color="{eb}" stop-opacity=".55"/></linearGradient></defs>'
            f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="{rx}" fill="{base}"/>'
            f'<g clip-path="url(#clip)"><g mask="url(#fm)">{body}</g></g>'
            f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="{rx}" fill="none" stroke="url(#edge)"/>')

MONO = 'ui-monospace,SFMono-Regular,&quot;SF Mono&quot;,Menlo,Consolas,&quot;Liberation Mono&quot;,monospace'
def build_banner():
    import random
    for out_mode in ("light", "dark"):
        mode = EFF(out_mode); t = THEME[mode]
        tiles = (["#ebedf0", mix(ACCENT, "#ffffff", .6), mix(ACCENT, "#ffffff", .3), ACCENT, mix(ACCENT, "#000000", .3)] if mode == "light" else
                 [mix(BASE["dark"], "#ffffff", .07), mix(ACCENT, BASE["dark"], .7), mix(ACCENT, BASE["dark"], .45), mix(ACCENT, BASE["dark"], .15), mix(ACCENT, "#ffffff", .15)])
        prompt = ACCENT if mode == "light" else mix(ACCENT, "#ffffff", .25)
        rnd = random.Random(7); cells = ""
        for col in range(14):
            for row in range(7):
                wts = [5, 3, 2, 2, 1] if col < 4 else [3, 2, 3, 3, 2]
                cells += f'<rect x="{612+col*17}" y="{52+row*17}" width="13" height="13" rx="2.5" fill="{tiles[rnd.choices(range(5), weights=wts)[0]]}"/>'
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="880" height="200" viewBox="0 0 880 200" role="img" aria-label="whoami: Maks Pavlovskyi, software engineer, SaaS, WordPress. Now building illustrates.dev">\n'
               + surface(880, 200, mode, 1.0) + "\n"
               f'<path d="M0.5 36 H879.5" stroke="{t["border"]}" stroke-opacity="0.7"/>\n'
               '<circle cx="22" cy="18" r="5.5" fill="#ff5f57"/><circle cx="40" cy="18" r="5.5" fill="#febc2e"/><circle cx="58" cy="18" r="5.5" fill="#28c840"/>\n'
               f'<text x="440" y="23" text-anchor="middle" fill="{t["muted"]}" font-family="{MONO}" font-size="12">makspavlovskyi — zsh</text>\n'
               f'<g font-family="{MONO}" font-size="17">\n'
               f'<text x="28" y="72" fill="{prompt}">$ <tspan fill="{t["fg"]}">whoami</tspan></text>\n'
               f'<text x="28" y="104" fill="{t["fg"]}" font-size="30" font-weight="600">Maks Pavlovskyi</text>\n'
               f'<text x="28" y="128" fill="{t["muted"]}">software engineer · SaaS · WordPress</text>\n'
               f'<text x="28" y="162" fill="{prompt}">$ <tspan fill="{t["fg"]}">now</tspan> <tspan fill="{t["muted"]}">→</tspan> <tspan fill="{t["fg"]}">building illustrates.dev</tspan></text>\n'
               f'<rect x="366" y="148" width="9" height="18" fill="{prompt}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" repeatCount="indefinite"/></rect>\n'
               f'</g>\n<g>{cells}</g>\n</svg>\n')
        open(f"{R}/assets/banner-{out_mode}.svg", "w").write(svg)

def icon(name, color, x, y, size=16):
    s = size / 24
    if name in LINE:
        return (f'<g transform="translate({x} {y}) scale({s})" fill="none" stroke="{color}" '
                f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{LINE[name]}</g>')
    return f'<g transform="translate({x} {y}) scale({s})"><path fill="{color}" d="{ICONS[name]}"/></g>'

try:  # Arial-metric font for measuring button labels; falls back to a glyph-width estimate
    from PIL import ImageFont
    _F = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", 100)
    def text_w(s, size):  # Arial metrics, +6% for SF/Segoe at weight 500
        return _F.getlength(s) / 100 * size * 1.06
except Exception:
    def text_w(s, size):
        return sum(.28 if c in " .,:;'|!iIlj" else .86 if c in "mwMW" else .66 if c.isupper() else .55 for c in s) * size * 1.06

def button(label, ico, mode, style="plain"):
    t = THEME[mode]
    h, pad, isz, gap, fs = 34, 14, 16, 8, 14
    w = round(pad + isz + gap + text_w(label, fs) + pad)
    if style == "bmc":
        bg, border, fg, ic = "#ffdd00", "#e6c700", "#1f2328", "#1f2328"
    elif style == "patreon":
        bg, border, fg, ic = t["fg"], t["fg"], t["bg"], t["bg"]
    else:
        bg, border, fg, ic = t["soft"], t["border"], t["fg"], t["fg"]
    m = 8 if style != "plain" else 0
    tx = m + pad + isz + gap
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w+m}" height="{h}" viewBox="0 0 {w+m} {h}" role="img" aria-label="{html.escape(label)}">'
            f'<rect x="{m+0.5}" y="0.5" width="{w-1}" height="{h-1}" rx="8" fill="{bg}" stroke="{border}"/>'
            f'{icon(ico, ic, m+pad, (h-isz)/2, isz)}'
            f'<text x="{tx}" y="{h/2+5}" fill="{fg}" font-family="{SANS}" font-size="{fs}" font-weight="500">{html.escape(label)}</text></svg>\n')

def card(name, desc, lang, lang_color, tech, mode):
    t = THEME[mode]
    w, h = 300, 150
    lines = textwrap.wrap(desc, 40)[:3]
    d = "".join(f'<tspan x="18" dy="{0 if i == 0 else 19}">{html.escape(l)}</tspan>' for i, l in enumerate(lines))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{html.escape(name)}: {html.escape(desc)}">'
            f'{surface(w, h, mode)}'
            f'{icon("repo", t["muted"], 18, 18, 16)}'
            f'<text x="42" y="31" fill="{t["link"]}" font-family="{SANS}" font-size="14.5" font-weight="600">{html.escape(name)}</text>'
            f'<text y="60" fill="{t["muted"]}" font-family="{SANS}" font-size="13">{d}</text>'
            f'<circle cx="24" cy="{h-24}" r="5" fill="{lang_color}"/>'
            f'<text x="35" y="{h-20}" fill="{t["fg"]}" font-family="{SANS}" font-size="12">{lang}'
            f'<tspan fill="{t["muted"]}"> · {html.escape(tech)}</tspan></text></svg>\n')

LINKS = [
    ("site",     "illustrates.dev", "globe",    "https://client.illustrates.dev/main-dashboard"),
    ("blog",     "Blog",            "pen",      "https://client.illustrates.dev/blog"),
    ("linkedin", "LinkedIn",        "linkedin", "https://linkedin.com/in/maksym-pavlovskyi-536647267"),
    ("medium",   "Medium",          "medium",   "https://medium.com/@pavlovskymaxym4"),
    ("email",    "Email",           "mail",     "mailto:illustrates.service@gmail.com"),
]
SUPPORT = [
    ("patreon", "Patreon",           "patreon", "https://www.patreon.com/maxpavlovs", "patreon"),
    ("bmc",     "Buy me a coffee",   "bmc",     "https://buymeacoffee.com/maxpavlovs", "bmc"),
]
PROJECTS = [
    ("illustrates.dev-platform-v2", "Full-stack portfolio platform: Express API and Next.js in one monorepo",
     "TypeScript", "#3178c6", "Next.js · BullMQ"),
    ("git-helper", "Interactive CLI for everyday git commands, with AI-suggested commit messages",
     "JavaScript", "#f1e05a", "Node · Inquirer"),
    ("js-challenges", "Virtual DOM renderer written from scratch, with its own tests",
     "JavaScript", "#f1e05a", "no libraries"),
]
STACK = "ts,js,react,redux,nodejs,express,graphql,tailwind,postgres,mysql,mongodb,redis,kafka,docker,nginx,aws,firebase,linux,git,postman,figma"

build_banner()
os.makedirs(f"{R}/assets/buttons", exist_ok=True)
os.makedirs(f"{R}/assets/cards", exist_ok=True)
for mode in ("light", "dark"):
    for key, label, ico, _ in LINKS:
        open(f"{R}/assets/buttons/{key}-{mode}.svg", "w").write(button(label, ico, mode))
    for key, label, ico, _, style in SUPPORT:
        open(f"{R}/assets/buttons/{key}-{mode}.svg", "w").write(button(label, ico, mode, style))
    for p in PROJECTS:
        open(f"{R}/assets/cards/{p[0]}-{mode}.svg", "w").write(card(*p, EFF(mode)))

def pic(light, dark, alt, extra=""):
    return (f'<picture><source media="(prefers-color-scheme: dark)" srcset="{dark}">'
            f'<img src="{light}" alt="{html.escape(alt)}"{extra}></picture>')

def btn(key, label, url, extra=""):
    return f'<a href="{url}">{pic(f"assets/buttons/{key}-light.svg", f"assets/buttons/{key}-dark.svg", label, extra)}</a>'

links = "\n".join(btn(k, l, u) for k, l, _, u in LINKS)
support = "\n".join(btn(k, l, u) for k, l, _, u, _s in SUPPORT)
cards = "\n".join(
    f'<a href="https://github.com/makspavlovskyi/{p[0]}">'
    + pic(f"assets/cards/{p[0]}-light.svg", f"assets/cards/{p[0]}-dark.svg", f"{p[0]}: {p[1]}", ' width="32%"') + "</a>"
    for p in PROJECTS)
SNAKE = "https://raw.githubusercontent.com/makspavlovskyi/makspavlovskyi/output/"
STREAK = "https://streak-stats.demolab.com/?user=makspavlovskyi&hide_border=true"
def _streak(mode):
    m = EFF(mode); c = (ACCENT if m == "light" else mix(ACCENT, "#ffffff", .2)).lstrip("#").upper()
    bg = "FFFFFF" if m == "light" else BASE["dark"].lstrip("#").upper()
    return ("" if m == "light" else "&theme=dark") + f"&background={bg}&ring={c}&fire={c}&currStreakLabel={c}"
STREAK_LIGHT, STREAK_DARK = _streak("light"), _streak("dark")

readme = f"""<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <img alt="$ whoami: Maks Pavlovskyi, software engineer, SaaS, WordPress. Now building illustrates.dev" src="assets/banner-light.svg" width="100%">
</picture>

<p>
<br>
{links}
{support}
</p>

### Selected work

<p>
{cards}
</p>

### What I actually use

Measured daily from the code in my public repos: language share from GitHub's byte counts, and frameworks found in each repo's dependencies and config files.

{pic("assets/generated/languages-light.svg", "assets/generated/languages-dark.svg", "Languages by share of code across my public repos", ' width="100%"')}

{pic("assets/generated/tools-light.svg", "assets/generated/tools-dark.svg", "Frameworks and tools found in my public repos, with repo counts", ' width="100%"')}

### Activity

<!-- activity:start (filled by scripts/update-profile.mjs: one linked card per repo) -->
<a href="https://github.com/makspavlovskyi?tab=repositories&sort=updated">{pic("assets/generated/activity-light.svg", "assets/generated/activity-dark.svg", "My most recently pushed public repositories", ' width="100%"')}</a>
<!-- activity:end -->

{pic(STREAK + STREAK_LIGHT, STREAK + STREAK_DARK, "GitHub streak for makspavlovskyi")}

{pic(SNAKE + "github-snake.svg", SNAKE + "github-snake-dark.svg", "Snake eating my GitHub contribution graph", ' width="100%"')}

"""
open(f"{R}/README.md", "w").write(readme)
print("ok")
