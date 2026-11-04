#!/usr/bin/env python3
"""QA all FRAME movie images and manifest / JavaScript references.
Requires Pillow. Run after `python tools/build_manifest.py`.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from collections import Counter
import json, re, sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
MOVIES=ROOT/'movies'
manifest=json.loads((MOVIES/'manifest.json').read_text(encoding='utf-8'))
poster_index=json.loads((ROOT/'poster-seed-v22.js').read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))
catalog=json.loads((ROOT/'catalog-v27.js').read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))
issues=[]
if manifest != catalog: issues.append('manifest/catalog mismatch')
if len(manifest)!=518: issues.append(f'Expected 518 scene rows; got {len(manifest)}')
if len(poster_index)!=276: issues.append(f'Expected 276 poster rows; got {len(poster_index)}')

def convert_url(url):
    if not isinstance(url,str) or not url.startswith('./movies/'):
        raise ValueError('Invalid movie URL: '+str(url))
    name=unquote(urlsplit(url).path.removeprefix('./'))
    p=(ROOT/name).resolve()
    if MOVIES.resolve() not in p.parents: raise ValueError('Unsafe movie URL: '+url)
    return p
urls=set()
for rec in manifest:
    for key in ('scene','poster'):
        if not rec.get(key): issues.append(f'Missing {key} for {rec.get("title")}'); continue
        urls.add(rec[key])
for rec in poster_index:
    urls.add(rec['poster'])
for url in urls:
    try:
        p=convert_url(url)
        if not p.is_file(): issues.append(f'Missing URL target: {url}')
    except Exception as e: issues.append(str(e))
images=sorted(p for p in MOVIES.rglob('*') if p.is_file() and p.suffix.lower() in ('.jpeg','.jpg','.png','.webp','.avif','.gif'))
formats=Counter()
for p in images:
    try:
        if p.suffix.lower()=='.webp': issues.append('WebP left: '+str(p))
        with Image.open(p) as im:
            formats[im.format]+=1
            suffix_formats={'.jpg':'JPEG','.jpeg':'JPEG','.png':'PNG'}
            if suffix_formats.get(p.suffix.lower())!=im.format: issues.append(f'Format mismatch: {p} = {im.format}')
            im.load()
            if not im.width or not im.height: issues.append(f'Empty dimensions: {p}')
    except Exception as e:
        issues.append(f'Image cannot be decoded: {p}: {e}')
if len(images)!=794: issues.append(f'Unexpected image count: {len(images)}')
if len(set((r['category'],r['title']) for r in manifest))!=276:
    issues.append('Unexpected movie count')
print(f'IMAGES={len(images)}, FORMATS={dict(formats)}, SCENES={len(manifest)}, MOVIES={len(set((r["category"],r["title"]) for r in manifest))}, POSTERS={len(poster_index)}, URLS={len(urls)}, ERRORS={len(issues)}')
for issue in issues[:60]:print('ERROR:',issue)
sys.exit(bool(issues))
