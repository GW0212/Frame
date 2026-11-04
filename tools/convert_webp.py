#!/usr/bin/env python3
"""Convert movie WebP files to true JPG (opaque) or PNG (transparency).

Requires Pillow: python -m pip install Pillow
Run before tools/build_manifest.py. The source .webp is deleted *only after*
conversion is saved and reopened successfully. Original pixel dimensions remain.
"""
from pathlib import Path
from PIL import Image, ImageOps
import sys

ROOT=Path(__file__).resolve().parents[1]
count=0
for path in sorted((ROOT/'movies').rglob('*')):
    if not path.is_file() or path.suffix.lower() != '.webp':
        continue
    with Image.open(path) as original:
        original.load()
        # Transparency preserving alpha compositing if present.
        alpha = original.mode in ('RGBA', 'LA') or 'transparency' in original.info
        target = path.with_suffix('.png' if alpha else '.jpg')
        if target.exists():
            raise FileExistsError(f'Target already exists: {target}')
        if alpha:
            data=original.convert('RGBA')
            data.save(target, format='PNG', optimize=True)
        else:
            data=original.convert('RGB')
            data.save(target, format='JPEG', quality=91, optimize=True, progressive=False)
        with Image.open(target) as check:
            check.load()
            if check.size != original.size:
                raise ValueError(f'Unexpected dimensions: {target}')
            if check.format not in ('JPEG','PNG'):
                raise ValueError(f'Unexpected format: {target}')
    path.unlink()
    count+=1
print(f'Converted {count} WebP files. Next run python tools/build_manifest.py')
