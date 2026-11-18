"""Fetch the CC0 scanned materials used by the rider review scene from Poly Haven."""
import concurrent.futures
import json
from pathlib import Path
import urllib.request

OUT = Path(__file__).resolve().parents[2] / 'assets-src/riders/textures'
OUT.mkdir(parents=True, exist_ok=True)
ASSETS = ['quatrefoil_jacquard_fabric', 'velour_velvet', 'fabric_leather_01']
MAPS = ['diff', 'nor_gl', 'rough', 'disp']


def fetch(item):
    asset, kind = item
    filename = f'{asset}_{kind}_4k.jpg'
    path = OUT / filename
    url = f'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/{asset}/{filename}'
    if path.exists() and path.stat().st_size > 10000:
        return filename, path.stat().st_size
    req = urllib.request.Request(url, headers={'User-Agent': 'DragonRiderMaterialStudy/1.0'})
    with urllib.request.urlopen(req, timeout=90) as response:
        path.write_bytes(response.read())
    return filename, path.stat().st_size


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    items = [(a, k) for a in ASSETS for k in MAPS]
    items += [(a, k) for a in ASSETS[:2] for k in ['anisotropy_rotation', 'anisotropy_strength', 'spec_ior']]
    for filename, size in executor.map(fetch, items):
        print(filename, size, flush=True)

(OUT / 'sources.json').write_text(json.dumps({
    'license': 'CC0',
    'resolution': '4096 x 4096',
    'assets': {a: 'https://polyhaven.com/a/' + a for a in ASSETS},
    'authors': {
        'quatrefoil_jacquard_fabric': 'colormass (photography), Rico Cilliers (processing)',
        'velour_velvet': 'colormass (photography), Rico Cilliers (processing)',
        'fabric_leather_01': 'Rob Tuytel',
    }
}, indent=2) + '\n')
