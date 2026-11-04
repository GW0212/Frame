#!/usr/bin/env python3
"""Build FRAME! movie manifest for GitHub Pages, no external libraries.
Folder layout: movies/{한국 영화|외국 영화}/{영화 제목}/{포스터,난이도 폴더}
"""
from pathlib import Path
from urllib.parse import quote
import json

ROOT = Path(__file__).resolve().parents[1]
MOVIES = ROOT / 'movies'
EXT = {'.jpg', '.jpeg', '.png'}  # v41: ignore stale WebP copies in GitHub storage
LEVELS = ('쉬움','중간','어려움')
CATEGORIES = ('한국 영화','외국 영화')
POSTERS = ('poster','포스터','cover','thumbnail')

def url(file: Path) -> str:
    return './' + '/'.join(quote(part, safe='') for part in file.relative_to(ROOT).parts)

rows = []
for category in CATEGORIES:
    root = MOVIES / category
    if not root.exists():
        continue
    for movie_dir in sorted(root.iterdir()):
        if not movie_dir.is_dir():
            continue
        posters = sorted(
            (x for x in movie_dir.iterdir() if x.is_file() and x.suffix.lower() in EXT and x.stem.lower() in POSTERS),
            key=lambda x: POSTERS.index(x.stem.lower())
        )
        poster = posters[0] if posters else None
        for level in LEVELS:
            folder = movie_dir / level
            if not folder.is_dir():
                continue
            for image in sorted(folder.iterdir()):
                if image.is_file() and image.suffix.lower() in EXT:
                    rows.append(dict(title=movie_dir.name, category=category, level=level,
                                     scene=url(image), poster=url(poster) if poster else ''))
(MOVIES / 'manifest.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
(ROOT / 'catalog-v27.js').write_text('window.FRAME_CATALOG_V27 = '+json.dumps(rows,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print(f'Wrote {len(rows)} movie scenes across {len(set((r["category"],r["title"]) for r in rows))} movies')

# Also refresh the initial poster index used on the home screen.
poster_entries = []
seen_movies = set()
for entry in rows:
    key = (entry['category'], entry['title'])
    if key not in seen_movies and entry['poster']:
        poster_entries.append({k: entry[k] for k in ('category', 'title', 'poster')})
        seen_movies.add(key)
(ROOT / 'poster-seed-v22.js').write_text('window.FRAME_POSTERS = ' + json.dumps(poster_entries, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
