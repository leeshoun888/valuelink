# Rewrites a .glb so every primitive uses 16-bit indices: a primitive with more than 65,535 vertices
# (32-bit indices) is split into several primitives of the same material. The Pleos Connect emulator's
# WebView drew nothing for the 66k-vertex body with 32-bit indices.
#   python3 split16.py in.glb [out.glb]
import json, struct, sys
import numpy as np

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else src
b = open(src, 'rb').read()
jlen = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + jlen])
blen = struct.unpack('<I', b[20 + jlen:24 + jlen])[0]
binbuf = bytearray(b[28 + jlen:28 + jlen + blen])

NP = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n, c, dt = a['count'], NC[a['type']], NP[a['componentType']]
    stride = bv.get('byteStride')
    item = np.dtype(dt).itemsize * c
    if stride and stride != item:
        raw = np.frombuffer(binbuf, np.uint8, n * stride, off).reshape(n, stride)[:, :item].copy()
        return raw.view(dt).reshape(n, c)
    return np.frombuffer(binbuf, dt, n * c, off).reshape(n, c).copy()


def write(arr, ctype, typ, target, minmax=False):
    global binbuf
    while len(binbuf) % 4:
        binbuf.append(0)
    off = len(binbuf)
    data = np.ascontiguousarray(arr).tobytes()
    binbuf += data
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
    acc = {'bufferView': len(j['bufferViews']) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
    if minmax:
        acc['min'] = [float(x) for x in arr.min(0)]
        acc['max'] = [float(x) for x in arr.max(0)]
    j['accessors'].append(acc)
    return len(j['accessors']) - 1


nsplit = 0
for m in j['meshes']:
    out = []
    for pr in m['primitives']:
        if 'indices' not in pr or j['accessors'][pr['indices']]['componentType'] != 5125 or pr.get('mode', 4) != 4:
            out.append(pr)
            continue
        idx = read(pr['indices']).reshape(-1, 3)
        attrs = {k: (read(v), j['accessors'][v]) for k, v in pr['attributes'].items()}
        # greedy: walk triangles in order, start a new chunk when the next one would pass 65,535 vertices
        chunks, cur, seen = [], [], set()
        for t in idx:
            new = [v for v in t if v not in seen]
            if len(seen) + len(new) > 65535:
                chunks.append(cur)
                cur, seen = [], set()
                new = list(t)
            cur.append(t)
            seen.update(new)
        chunks.append(cur)
        for ch in chunks:
            tri = np.array(ch, dtype=np.uint32)
            uniq, inv = np.unique(tri.ravel(), return_inverse=True)
            npr = {k: v for k, v in pr.items() if k not in ('attributes', 'indices')}
            npr['attributes'] = {}
            for k, (arr, a) in attrs.items():
                sub = arr[uniq]
                npr['attributes'][k] = write(sub, a['componentType'], a['type'], 34962, minmax=(k == 'POSITION'))
                if a.get('normalized'):
                    j['accessors'][-1]['normalized'] = True
            npr['indices'] = write(inv.astype(np.uint16), 5123, 'SCALAR', 34963)
            out.append(npr)
        nsplit += 1
        print(f"{m['name']}: {len(idx)} triangles, {len(attrs['POSITION'][0])} vertices -> {len(chunks)} primitives "
              + ', '.join(str(len(np.unique(np.array(c)))) for c in chunks))
    m['primitives'] = out

# compact: keep only the accessors and buffer views still referenced, and repack the binary chunk
used_acc = set()
for m in j['meshes']:
    for pr in m['primitives']:
        used_acc.update(pr['attributes'].values())
        if 'indices' in pr:
            used_acc.add(pr['indices'])
        for t in pr.get('targets', []):
            used_acc.update(t.values())
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s:
        used_acc.add(s['inverseBindMatrices'])
for an in j.get('animations', []):
    for sm in an['samplers']:
        used_acc.update([sm['input'], sm['output']])
amap = {o: n for n, o in enumerate(sorted(used_acc))}
accs = [j['accessors'][o] for o in sorted(used_acc)]
used_bv = sorted({a['bufferView'] for a in accs if 'bufferView' in a} | {im['bufferView'] for im in j.get('images', []) if 'bufferView' in im})
bmap, nb, bvs = {}, bytearray(), []
for n, o in enumerate(used_bv):
    bv = dict(j['bufferViews'][o])
    while len(nb) % 4:
        nb.append(0)
    s0 = bv.get('byteOffset', 0)
    nb += binbuf[s0:s0 + bv['byteLength']]
    bv['byteOffset'] = len(nb) - bv['byteLength']
    bvs.append(bv)
    bmap[o] = n
for a in accs:
    if 'bufferView' in a:
        a['bufferView'] = bmap[a['bufferView']]
for im in j.get('images', []):
    if 'bufferView' in im:
        im['bufferView'] = bmap[im['bufferView']]
j['accessors'], j['bufferViews'] = accs, bvs
for m in j['meshes']:
    for pr in m['primitives']:
        pr['attributes'] = {k: amap[v] for k, v in pr['attributes'].items()}
        if 'indices' in pr:
            pr['indices'] = amap[pr['indices']]
        if 'targets' in pr:
            pr['targets'] = [{k: amap[v] for k, v in t.items()} for t in pr['targets']]
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s:
        s['inverseBindMatrices'] = amap[s['inverseBindMatrices']]
for an in j.get('animations', []):
    for sm in an['samplers']:
        sm['input'], sm['output'] = amap[sm['input']], amap[sm['output']]
binbuf = nb
j['buffers'][0]['byteLength'] = len(binbuf)
while len(binbuf) % 4:
    binbuf.append(0)
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4:
    js += b' '
total = 12 + 8 + len(js) + 8 + len(binbuf)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
    f.write(struct.pack('<II', len(binbuf), 0x004E4942) + bytes(binbuf))
print('split', nsplit, 'primitive(s);', dst, total, 'bytes')
