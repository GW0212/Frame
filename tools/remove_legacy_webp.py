#!/usr/bin/env python3
"""Remove obsolete .webp movie copies from GitHub Pages build checkout.
Does not change the remote Git repository or any JPG/PNG.
"""
from pathlib import Path
movies=Path(__file__).resolve().parents[1]/'movies'
stale=[p for p in movies.rglob('*') if p.is_file() and p.suffix.lower()=='.webp']
for path in stale:
    path.unlink()
print(f'FRAME deployment: removed {len(stale)} outdated WebP file(s) from build workspace.')
